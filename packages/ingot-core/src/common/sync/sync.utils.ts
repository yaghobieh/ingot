import { CHAT_KEY_PREFIX, NEVER_SYNC_SETTING_PREFIXES, RULE_KEY_PREFIX, SECRET_SETTING_PATTERN, SYNC_KEY_PATTERN, SYNC_MAX_ITEM_BYTES } from './sync.consts';
import type { ChatMeta, SyncDelete, SyncItem, SyncKind, SyncPush, SyncState } from './sync.types';

export const itemId = (kind: SyncKind, key: string): string => `${kind}|${key}`;
export const splitId = (id: string): { kind: SyncKind; key: string } => {
    const at = id.indexOf('|');
    return { kind: id.slice(0, at) as SyncKind, key: id.slice(at + 1) };
};

export const emptySyncState = (): SyncState => ({ cursor: 0, versions: {}, hashes: {} });

/** Stable JSON (sorted keys) so equal data always hashes the same. */
export const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
};

/** FNV-1a over the stable JSON; only used to notice local changes. */
export const hashData = (value: unknown): string => {
    let hash = 0x811c9dc5;
    const text = stableJson(value);
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16);
};

/** User settings that may leave the machine: no account URLs, nothing credential-like, valid keys only. */
export const syncableSettings = (user: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(user).filter(([key, value]) =>
        value !== undefined && SYNC_KEY_PATTERN.test(key) && !NEVER_SYNC_SETTING_PREFIXES.some(p => key.startsWith(p)) && !SECRET_SETTING_PATTERN.test(key)));

export const isSyncableSetting = (key: string): boolean => Object.keys(syncableSettings({ [key]: true })).length === 1;

export const ruleKey = (fileName: string): string | undefined => {
    const key = `${RULE_KEY_PREFIX}${fileName}`;
    return SYNC_KEY_PATTERN.test(key) && !fileName.includes('/') && !fileName.startsWith('.') ? key : undefined;
};
export const ruleName = (key: string): string | undefined => {
    const name = key.startsWith(RULE_KEY_PREFIX) ? key.slice(RULE_KEY_PREFIX.length) : '';
    return name && ruleKey(name) === key ? name : undefined;
};

/** `team.md` -> `team.conflict.md` (the other device's version, kept next to ours). */
export const conflictCopyName = (name: string): string => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}.conflict${name.slice(dot)}` : `${name}.conflict`;
};

export const chatKey = (id: string): string | undefined => {
    const key = `${CHAT_KEY_PREFIX}${id}`;
    return SYNC_KEY_PATTERN.test(key) ? key : undefined;
};

/** Chat list metadata (title, pinned, order, timestamps); never message bodies. */
export const chatMetaOf = (chats: readonly { id: string; title: string; pinned?: boolean; updatedAt: number }[]): Map<string, ChatMeta> =>
    new Map(chats.flatMap((chat, order) => {
        const key = chatKey(chat.id);
        return key ? [[key, { title: chat.title, pinned: !!chat.pinned, order, updatedAt: chat.updatedAt }] as [string, ChatMeta]] : [];
    }));

export const tooLarge = (data: unknown): boolean => new TextEncoder().encode(JSON.stringify(data)).length > SYNC_MAX_ITEM_BYTES;

/**
 * What to push: items whose data changed since the last sync (by hash) and deletions of items this install synced
 * before but no longer has. `kinds` limits deletions to the kinds actually collected.
 */
export const planPush = (local: ReadonlyMap<string, unknown>, state: SyncState, kinds: readonly SyncKind[]): { puts: SyncPush[]; deletes: SyncDelete[] } => {
    const puts: SyncPush[] = [];
    for (const [id, data] of local) {
        if (state.hashes[id] !== hashData(data) && !tooLarge(data)) {
            const { kind, key } = splitId(id);
            puts.push({ kind, key, data, ...(state.versions[id] ? { baseVersion: state.versions[id] } : {}) });
        }
    }
    const deletes = Object.keys(state.hashes).filter(id => !local.has(id) && kinds.includes(splitId(id).kind))
        .map(id => ({ ...splitId(id), ...(state.versions[id] ? { baseVersion: state.versions[id] } : {}) }));
    return { puts, deletes };
};

/** Records a pulled or pushed item in the state (tombstones forget the hash so the item is not deleted again). */
export const recordItem = (state: SyncState, item: Pick<SyncItem, 'kind' | 'key' | 'data' | 'version' | 'deleted'>): void => {
    const id = itemId(item.kind, item.key);
    state.versions[id] = item.version;
    if (item.deleted) {
        delete state.hashes[id];
    } else {
        state.hashes[id] = hashData(item.data);
    }
};

/** Parses a GET /v1/sync page; malformed rows are dropped. */
export const parsePull = (body: unknown): { items: SyncItem[]; cursor: number; hasMore: boolean } => {
    const b = body && typeof body === 'object' ? body as { items?: unknown; cursor?: unknown; hasMore?: unknown } : {};
    const items = (Array.isArray(b.items) ? b.items : []).filter((i): i is SyncItem => !!i && typeof i === 'object'
        && typeof (i as SyncItem).kind === 'string' && typeof (i as SyncItem).key === 'string' && typeof (i as SyncItem).version === 'number');
    return { items, cursor: typeof b.cursor === 'number' ? b.cursor : 0, hasMore: b.hasMore === true };
};

/** Text payload of a rules / keybindings item. */
export const textOf = (data: unknown): string | undefined =>
    data && typeof data === 'object' && typeof (data as { text?: unknown }).text === 'string' ? (data as { text: string }).text : undefined;
