import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceProviderProvider, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { AccountBackend } from '../../common/account/account-protocol';
import { IDE_FLAGS } from '../../common/config/remote-config.consts';
import { RULES_DIR, RULE_EXTENSIONS } from '../../common/project-config/project-config.consts';
import {
    KEYBINDINGS_KEY, KEYMAPS_FILE, SYNC_DEBOUNCE_MS, SYNC_DEVICE_KEY, SYNC_FOCUS_THROTTLE_MS, SYNC_INTERVAL_MS, SYNC_KINDS, SYNC_PATH, SYNC_PREFERENCE,
    SYNC_NOW_COMMAND, SYNC_PULL_LIMIT, SYNC_STATE_PREFIX, SYNC_TEXT
} from '../../common/sync/sync.consts';
import type { SyncItem, SyncKind, SyncState } from '../../common/sync/sync.types';
import {
    chatMetaOf, conflictCopyName, emptySyncState, isSyncableSetting, itemId, parsePull, planPush, recordItem, ruleKey, ruleName, syncableSettings, textOf
} from '../../common/sync/sync.utils';
import { IngotAccountService } from '../account/account-service';
import { AgentStore } from '../agents/agent-store';
import { IngotFeatureFlags } from '../config/feature-flags';

const MAX_PULL_PAGES = 50;

/**
 * Settings sync through /v1/sync (IDEA-126, contract §4): user settings (per key), global rules, keymaps.json and
 * chat list metadata. Pull with a cursor, push changed items with `baseVersion`, tombstones both ways. Runs at
 * startup, on focus, every 5 minutes and ~2 s after local edits, only while signed in with "Sync settings" on.
 */
@injectable()
export class IngotSyncService implements FrontendApplicationContribution, CommandContribution {

    @inject(AccountBackend) protected readonly backend: AccountBackend;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(PreferenceProviderProvider) protected readonly providers: PreferenceProviderProvider;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(FileService) protected readonly files: FileService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(MessageService) protected readonly messages: MessageService;

    protected running?: Promise<void>;
    protected again = false;
    protected applying = false;
    protected debounce?: ReturnType<typeof setTimeout>;
    protected interval?: ReturnType<typeof setInterval>;
    protected lastRun = 0;
    protected signedIn = false;
    /** Last finished sync (epoch ms) and its outcome, for tests and the status tooltip. */
    lastSync?: { at: number; ok: boolean };

    @postConstruct()
    protected init(): void {
        this.account.onDidChange(() => {
            const signedIn = this.account.signedIn;
            if (signedIn !== this.signedIn) {
                this.signedIn = signedIn;
                if (signedIn) {
                    this.sync();
                }
            }
        });
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === SYNC_PREFERENCE) {
                this.sync();
            } else if (!this.applying && e.scope === PreferenceScope.User && isSyncableSetting(e.preferenceName)) {
                this.schedule();
            }
        });
        this.agents.onDidChange(() => this.schedule(SYNC_DEBOUNCE_MS * 5));
    }

    onStart(): void {
        this.interval = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
        window.addEventListener('focus', () => {
            if (Date.now() - this.lastRun > SYNC_FOCUS_THROTTLE_MS) {
                this.sync();
            }
        });
        this.configDir().then(dir => this.files.onDidFilesChange(e => {
            if (!this.applying && e.changes.some(c => dir.resolve(RULES_DIR).isEqualOrParent(c.resource) || c.resource.isEqual(dir.resolve(KEYMAPS_FILE)))) {
                this.schedule();
            }
        }));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SYNC_NOW_COMMAND, { isEnabled: () => this.enabled, isVisible: () => this.enabled, execute: () => this.sync() });
    }

    onStop(): void {
        clearInterval(this.interval);
    }

    get enabled(): boolean {
        return this.account.signedIn && !this.account.blocked && this.preferences.get<boolean>(SYNC_PREFERENCE, true) && this.flags.enabled(IDE_FLAGS.settingsSync);
    }

    protected schedule(delay = SYNC_DEBOUNCE_MS): void {
        if (!this.enabled) {
            return;
        }
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.sync(), delay);
    }

    /** Runs one pull + push (coalesces concurrent calls into one follow-up run). */
    sync(): Promise<void> {
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = this.run().finally(() => {
            this.running = undefined;
            if (this.again) {
                this.again = false;
                this.sync();
            }
        });
        return this.running;
    }

    protected get stateKey(): string {
        return `${SYNC_STATE_PREFIX}${this.account.urls.serverUrl}|${this.account.snapshot.user?.email ?? ''}`;
    }

    protected loadState(): SyncState {
        try {
            const raw = JSON.parse(localStorage.getItem(this.stateKey) ?? '') as SyncState;
            return typeof raw.cursor === 'number' ? { cursor: raw.cursor, versions: raw.versions ?? {}, hashes: raw.hashes ?? {} } : emptySyncState();
        } catch {
            return emptySyncState();
        }
    }

    protected saveState(state: SyncState): void {
        localStorage.setItem(this.stateKey, JSON.stringify(state));
    }

    /** Stable random id per install, so other devices can tell where a change came from. */
    protected get device(): string {
        let id = localStorage.getItem(SYNC_DEVICE_KEY);
        if (!id) {
            id = `ide-${crypto.randomUUID()}`;
            localStorage.setItem(SYNC_DEVICE_KEY, id);
        }
        return id;
    }

    protected async run(): Promise<void> {
        if (!this.enabled) {
            return;
        }
        this.lastRun = Date.now();
        const state = this.loadState();
        let ok = true;
        try {
            ok = await this.pull(state) && await this.push(state);
        } finally {
            this.saveState(state);
            this.lastSync = { at: Date.now(), ok };
        }
    }

    protected async pull(state: SyncState): Promise<boolean> {
        for (let page = 0; page < MAX_PULL_PAGES; page++) {
            const response = await this.backend.syncRequest('GET', `${SYNC_PATH}?since=${state.cursor}&kinds=${SYNC_KINDS.join(',')}&limit=${SYNC_PULL_LIMIT}`);
            if (response.status !== 200) {
                return false;
            }
            const { items, cursor, hasMore } = parsePull(response.body);
            for (const item of items) {
                if (item.device !== this.device) {
                    await this.apply(item).catch(() => undefined);
                }
                recordItem(state, item);
            }
            state.cursor = Math.max(state.cursor, cursor);
            if (!hasMore) {
                return true;
            }
        }
        return true;
    }

    protected async apply(item: SyncItem): Promise<void> {
        this.applying = true;
        try {
            const dir = await this.configDir();
            if (item.kind === 'settings' && isSyncableSetting(item.key)) {
                const value = item.deleted ? undefined : (item.data as { value?: unknown } | null)?.value;
                await this.preferences.set(item.key, value, PreferenceScope.User);
            } else if (item.kind === 'keybindings' && item.key === KEYBINDINGS_KEY) {
                const text = textOf(item.data);
                await this.writeOrDelete(dir.resolve(KEYMAPS_FILE), item.deleted ? undefined : text);
            } else if (item.kind === 'rules') {
                const name = ruleName(item.key);
                if (name) {
                    await this.writeOrDelete(dir.resolve(RULES_DIR).resolve(name), item.deleted ? undefined : textOf(item.data));
                }
            } else if (item.kind === 'chats' && !item.deleted && item.data && typeof item.data === 'object') {
                this.agents.applySyncedMeta(item.key.slice(item.key.indexOf('/') + 1), item.data as { title?: unknown; pinned?: unknown });
            }
        } finally {
            // File watchers fire after the write; keep ignoring our own writes for a moment.
            setTimeout(() => { this.applying = false; }, SYNC_DEBOUNCE_MS);
        }
    }

    protected async writeOrDelete(uri: URI, text: string | undefined): Promise<void> {
        if (text === undefined) {
            if (await this.files.exists(uri)) {
                await this.files.delete(uri);
            }
            return;
        }
        await this.files.write(uri, text);
    }

    protected async push(state: SyncState): Promise<boolean> {
        const local = await this.collect();
        const { puts, deletes } = planPush(local, state, SYNC_KINDS);
        let ok = true;
        for (const put of puts) {
            const response = await this.backend.syncRequest('PUT', `${SYNC_PATH}/${put.kind}/${encodeURIComponent(put.key)}`, { data: put.data, baseVersion: put.baseVersion, device: this.device });
            const body = response.body as { item?: SyncItem; conflict?: boolean; previous?: SyncItem };
            if (response.status !== 200 || !body.item) {
                ok = false;
                continue;
            }
            recordItem(state, body.item);
            if (body.conflict && body.previous && put.kind === 'rules') {
                await this.keepConflictCopy(put.key, body.previous);
            }
        }
        for (const del of deletes) {
            const response = await this.backend.syncRequest('DELETE', `${SYNC_PATH}/${del.kind}/${encodeURIComponent(del.key)}`, { baseVersion: del.baseVersion });
            const item = (response.body as { item?: SyncItem }).item;
            if (response.status === 200 && item) {
                recordItem(state, item);
            } else if (response.status === 404) {
                recordItem(state, { kind: del.kind, key: del.key, data: null, version: del.baseVersion ?? 0, deleted: true });
            } else {
                ok = false;
            }
        }
        return ok;
    }

    /** Rules: both versions survive a conflict; the other device's copy lands next to ours. */
    protected async keepConflictCopy(key: string, previous: SyncItem): Promise<void> {
        const name = ruleName(key);
        const text = textOf(previous.data);
        if (!name || text === undefined) {
            return;
        }
        const copy = conflictCopyName(name);
        this.applying = true;
        await this.files.write((await this.configDir()).resolve(RULES_DIR).resolve(copy), text).catch(() => undefined);
        setTimeout(() => { this.applying = false; }, SYNC_DEBOUNCE_MS);
        this.messages.info(SYNC_TEXT.ruleConflict(name, copy));
    }

    /** Everything this install would sync right now, by item id. */
    protected async collect(): Promise<Map<string, unknown>> {
        const local = new Map<string, unknown>();
        const user = (this.providers(PreferenceScope.User)?.getPreferences() ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(syncableSettings(user))) {
            local.set(itemId('settings', key), { value });
        }
        const dir = await this.configDir();
        const keymaps = await this.readText(dir.resolve(KEYMAPS_FILE));
        if (keymaps !== undefined && keymaps.trim()) {
            local.set(itemId('keybindings', KEYBINDINGS_KEY), { text: keymaps });
        }
        const rulesDir = dir.resolve(RULES_DIR);
        const stat = await this.files.resolve(rulesDir).catch(() => undefined);
        for (const child of stat?.children ?? []) {
            const key = child.isFile && RULE_EXTENSIONS.some(ext => child.name.endsWith(ext)) && !child.name.includes('.conflict.') ? ruleKey(child.name) : undefined;
            const text = key ? await this.readText(child.resource) : undefined;
            if (key && text !== undefined) {
                local.set(itemId('rules', key), { text });
            }
        }
        for (const [key, meta] of chatMetaOf(this.agents.allSessions)) {
            local.set(itemId('chats', key), meta);
        }
        return local;
    }

    protected async readText(uri: URI): Promise<string | undefined> {
        try {
            return (await this.files.read(uri)).value;
        } catch {
            return undefined;
        }
    }

    protected configDirUri?: Promise<URI>;
    protected configDir(): Promise<URI> {
        this.configDirUri ??= this.env.getConfigDirUri().then(uri => new URI(uri));
        return this.configDirUri;
    }

    /** Kinds this service syncs (for the docs / tests). */
    static readonly kinds: readonly SyncKind[] = SYNC_KINDS;
}
