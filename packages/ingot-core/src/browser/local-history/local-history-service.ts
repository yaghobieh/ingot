import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ChangeTracker } from '../changes/change-tracker';
import type { AgentEditEvent } from '../../common/changes/changes.types';
import { isPending } from '../../common/changes/changes.utils';
import { INLINE_EDIT_SESSION_PREFIX } from '../../common/inline-edit/inline-edit.consts';
import {
    HISTORY_LABELS, LOCAL_HISTORY_DIR, LOCAL_HISTORY_GITIGNORE, LOCAL_HISTORY_INDEX, MAX_HISTORY_ENTRIES, MAX_SNAPSHOT_CHARS
} from '../../common/local-history/local-history.consts';
import type { HistoryEntry, HistoryIndex, HistorySource } from '../../common/local-history/local-history.types';
import { appendEntry, createEntry, historyFolderName, isHistoryPath, parseIndex, snapshotFileName } from '../../common/local-history/local-history.utils';

interface HistoryLocation {
    readonly root: URI;
    readonly relative: string;
    /** This file's folder under `.ingot/history`. */
    readonly dir: URI;
}

/**
 * Local History (IDEA-262): a snapshot of a workspace file on every save and around every agent edit, kept in
 * `.ingot/history/<file>/` (an index plus one file per version). Identical consecutive versions are stored once.
 */
@injectable()
export class LocalHistoryService implements FrontendApplicationContribution {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MonacoWorkspace) protected readonly monacoWorkspace: MonacoWorkspace;
    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;

    protected readonly onDidChangeEmitter = new Emitter<string>();
    /** Fires with the file URI whose history changed. */
    readonly onDidChange: Event<string> = this.onDidChangeEmitter.event;
    /** Writes per file run one after another, so dedupe always compares with the version written last. */
    protected readonly queues = new Map<string, Promise<unknown>>();
    protected readonly ignoredRoots = new Set<string>();
    /** Text of files as opened, written as the "Original" version before a file's first snapshot. */
    protected readonly baselines = new Map<string, string>();

    onStart(): void {
        this.monacoWorkspace.onDidOpenTextDocument(model => {
            if (this.location(new URI(model.uri)) && !this.baselines.has(model.uri)) {
                this.baselines.set(model.uri, model.getText());
            }
        });
        this.monacoWorkspace.onDidCloseTextDocument(model => this.baselines.delete(model.uri));
        this.monacoWorkspace.onDidSaveTextDocument(model => {
            // Auto-save also writes an agent proposal still in review; its version is recorded once it is decided.
            if (!this.tracker.changes.some(c => c.uri === model.uri && isPending(c))) {
                void this.record(new URI(model.uri), model.getText(), 'save');
            }
        });
        this.tracker.onDidEdit(event => void this.recordAgentEdit(event));
    }

    location(uri: URI): HistoryLocation | undefined {
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(uri))?.resource;
        const relative = root?.relative(uri)?.toString();
        if (!root || !relative || isHistoryPath(relative)) {
            return undefined;
        }
        return { root, relative, dir: root.resolve(LOCAL_HISTORY_DIR).resolve(historyFolderName(relative)) };
    }

    async entries(uri: URI): Promise<readonly HistoryEntry[]> {
        const location = this.location(uri);
        return location ? (await this.readIndex(location)).entries : [];
    }

    async read(uri: URI, entry: HistoryEntry): Promise<string> {
        const location = this.location(uri);
        return location ? this.readSnapshot(location, entry) : '';
    }

    /** Snapshots `text` unless it equals the latest version. Resolves with the new entry, if any. */
    record(uri: URI, text: string, source: HistorySource, label?: string): Promise<HistoryEntry | undefined> {
        const key = uri.toString();
        const next = (this.queues.get(key) ?? Promise.resolve())
            .then(() => this.doRecord(uri, text, source, label))
            .catch(() => undefined);
        this.queues.set(key, next);
        return next;
    }

    /** Puts a version back into the file (one undo step) and saves it; the current text is kept as "Before restore". */
    async restore(uri: URI, entry: HistoryEntry): Promise<void> {
        const text = await this.read(uri, entry);
        const ref = await this.textModels.createModelReference(uri);
        try {
            const model = ref.object.textEditorModel;
            await this.record(uri, model.getValue(), 'restore');
            model.pushStackElement();
            model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
            model.pushStackElement();
            await ref.object.save();
        } finally {
            ref.dispose();
        }
    }

    protected recordAgentEdit({ uri, sessionId, phase, text }: AgentEditEvent): Promise<HistoryEntry | undefined> {
        const inline = sessionId.startsWith(INLINE_EDIT_SESSION_PREFIX);
        const source: HistorySource = inline ? 'inline-edit' : 'agent';
        const before = inline ? HISTORY_LABELS.beforeInlineEdit : HISTORY_LABELS.beforeAgent;
        return this.record(new URI(uri), text, source, phase === 'before' ? before : undefined);
    }

    protected async doRecord(uri: URI, text: string, source: HistorySource, label?: string): Promise<HistoryEntry | undefined> {
        const location = this.location(uri);
        if (!location || text.length > MAX_SNAPSHOT_CHARS) {
            return undefined;
        }
        let index = await this.readIndex(location);
        const baseline = this.baselines.get(uri.toString());
        this.baselines.delete(uri.toString());
        if (!index.entries.length && baseline !== undefined && baseline !== text && baseline.length <= MAX_SNAPSHOT_CHARS) {
            index = (await this.append(location, index, baseline, 'save', HISTORY_LABELS.original)).index;
        }
        const latest = index.entries[0];
        if (latest && await this.readSnapshot(location, latest) === text) {
            return undefined;
        }
        const { entry } = await this.append(location, index, text, source, label);
        this.onDidChangeEmitter.fire(uri.toString());
        return entry;
    }

    protected async append(location: HistoryLocation, index: HistoryIndex, text: string, source: HistorySource, label?: string): Promise<{ entry: HistoryEntry; index: HistoryIndex }> {
        await this.ensureIgnored(location.root);
        const entry = createEntry({ timestamp: Date.now(), source, label, size: text.length }, index.entries);
        await this.files.write(location.dir.resolve(snapshotFileName(entry)), text);
        const { index: next, dropped } = appendEntry(index, entry, MAX_HISTORY_ENTRIES);
        await this.files.write(location.dir.resolve(LOCAL_HISTORY_INDEX), JSON.stringify(next, undefined, 2));
        for (const old of dropped) {
            await this.files.delete(location.dir.resolve(snapshotFileName(old))).catch(() => undefined);
        }
        return { entry, index: next };
    }

    protected async readIndex(location: HistoryLocation): Promise<HistoryIndex> {
        const text = await this.files.read(location.dir.resolve(LOCAL_HISTORY_INDEX)).then(c => c.value).catch(() => undefined);
        return parseIndex(text, location.relative);
    }

    protected readSnapshot(location: HistoryLocation, entry: HistoryEntry): Promise<string> {
        return this.files.read(location.dir.resolve(snapshotFileName(entry))).then(c => c.value).catch(() => '');
    }

    protected async ensureIgnored(root: URI): Promise<void> {
        const key = root.toString();
        if (this.ignoredRoots.has(key)) {
            return;
        }
        const ignore = root.resolve(LOCAL_HISTORY_DIR).resolve(LOCAL_HISTORY_GITIGNORE.name);
        if (!await this.files.exists(ignore)) {
            await this.files.write(ignore, LOCAL_HISTORY_GITIGNORE.content);
        }
        this.ignoredRoots.add(key);
    }
}
