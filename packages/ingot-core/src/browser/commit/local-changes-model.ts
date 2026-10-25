import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { CommandService } from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { applySelectedHunks, changeHunks, parseStatusEntries, type ChangeEntry, type ChangeHunk } from '../../common/git/changes';
import { parseRecentMessages } from '../../common/git/git-ops';
import { GitService } from '../../common/git/git.types';
import { DEFAULT_CHANGELIST } from './commit.consts';

export interface CommitOptions {
    readonly message: string;
    readonly amend: boolean;
    readonly signoff: boolean;
    readonly runHooks: boolean;
}

interface StoredState {
    changelists: Record<string, string[]>;
    unchecked: string[];
    messages: string[];
}

/**
 * State behind the Local Changes tool window (IDEA-74): `git status`, changelists, which files and chunks are
 * included, and the commit itself (whole files with `--only`, or selected chunks written to the index).
 */
@injectable()
export class LocalChangesModel {

    @inject(GitService) protected readonly git: GitService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(CommandService) protected readonly commands: CommandService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    entries: ChangeEntry[] = [];
    branch = '';
    error = '';
    loading = false;
    /** Named changelists other than the default: name -> paths. */
    changelists = new Map<string, Set<string>>();
    /** Paths the user unchecked (everything else is included). */
    unchecked = new Set<string>();
    /** Unversioned files are excluded until checked. */
    checkedUnversioned = new Set<string>();
    /** path -> chunk indices left out of the commit (gutter checkboxes in the diff viewer). */
    excludedHunks = new Map<string, Set<number>>();
    /** Messages typed here, newest first, merged with recent commit messages. */
    history: string[] = [];

    @postConstruct()
    protected init(): void {
        this.workspace.onWorkspaceChanged(() => this.refresh());
        this.files.onDidFilesChange(() => this.scheduleRefresh());
        this.workspace.ready.then(() => this.load()).then(() => this.refresh());
    }

    get root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    get rootUri(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    uriOf(path: string): URI | undefined {
        return this.rootUri?.resolve(path);
    }

    protected get storageKey(): string {
        return `ingot.localChanges:${this.root ?? ''}`;
    }

    protected async load(): Promise<void> {
        const state = await this.storage.getData<StoredState>(this.storageKey);
        if (state) {
            this.changelists = new Map(Object.entries(state.changelists ?? {}).map(([k, v]) => [k, new Set(v)]));
            this.unchecked = new Set(state.unchecked ?? []);
            this.history = state.messages ?? [];
        }
    }

    protected save(): void {
        const changelists: Record<string, string[]> = {};
        this.changelists.forEach((v, k) => { changelists[k] = [...v]; });
        this.storage.setData<StoredState>(this.storageKey, { changelists, unchecked: [...this.unchecked], messages: this.history.slice(0, 30) });
    }

    protected changed(): void {
        this.onDidChangeEmitter.fire();
    }

    protected timer: ReturnType<typeof setTimeout> | undefined;
    scheduleRefresh(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 400);
    }

    async refresh(): Promise<void> {
        const root = this.root;
        if (!root) {
            this.entries = [];
            this.changed();
            return;
        }
        this.loading = true;
        try {
            const [status, branch] = await Promise.all([
                this.git.run(root, { kind: 'status' }),
                this.git.run(root, { kind: 'currentBranch' }).catch(() => ({ output: '' }))
            ]);
            this.entries = parseStatusEntries(status.output);
            this.branch = branch.output.trim();
            this.error = '';
            const live = new Set(this.entries.map(e => e.path));
            for (const set of [this.unchecked, this.checkedUnversioned, ...this.changelists.values()]) {
                [...set].filter(p => !live.has(p)).forEach(p => set.delete(p));
            }
            [...this.excludedHunks.keys()].filter(p => !live.has(p)).forEach(p => this.excludedHunks.delete(p));
        } catch (error) {
            this.entries = [];
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            this.changed();
        }
    }

    /** Changelist a tracked path belongs to. */
    changelistOf(path: string): string {
        for (const [name, paths] of this.changelists) {
            if (paths.has(path)) {
                return name;
            }
        }
        return DEFAULT_CHANGELIST;
    }

    get changelistNames(): string[] {
        return [DEFAULT_CHANGELIST, ...[...this.changelists.keys()].filter(n => n !== DEFAULT_CHANGELIST)];
    }

    moveToChangelist(paths: readonly string[], name: string): void {
        for (const set of this.changelists.values()) {
            paths.forEach(p => set.delete(p));
        }
        if (name !== DEFAULT_CHANGELIST) {
            const set = this.changelists.get(name) ?? new Set<string>();
            paths.forEach(p => set.add(p));
            this.changelists.set(name, set);
        }
        [...this.changelists].filter(([, v]) => !v.size).forEach(([k]) => this.changelists.delete(k));
        this.save();
        this.changed();
    }

    isChecked(entry: ChangeEntry): boolean {
        return entry.status === 'untracked' ? this.checkedUnversioned.has(entry.path) : !this.unchecked.has(entry.path);
    }

    setChecked(paths: readonly string[], checked: boolean): void {
        for (const path of paths) {
            const entry = this.entries.find(e => e.path === path);
            if (!entry) {
                continue;
            }
            if (entry.status === 'untracked') {
                if (checked) { this.checkedUnversioned.add(path); } else { this.checkedUnversioned.delete(path); }
            } else {
                if (checked) { this.unchecked.delete(path); } else { this.unchecked.add(path); }
            }
        }
        this.save();
        this.changed();
    }

    get included(): ChangeEntry[] {
        return this.entries.filter(e => this.isChecked(e));
    }

    isHunkIncluded(path: string, index: number): boolean {
        return !this.excludedHunks.get(path)?.has(index);
    }

    toggleHunk(path: string, index: number): void {
        const set = this.excludedHunks.get(path) ?? new Set<number>();
        if (set.has(index)) { set.delete(index); } else { set.add(index); }
        this.excludedHunks.set(path, set);
        if (set.size) {
            this.setChecked([path], true);
        }
        this.changed();
    }

    /** HEAD version of a file ('' for new files). */
    async base(path: string): Promise<string> {
        const root = this.root;
        return root ? (await this.git.show(root, 'HEAD', path).catch(() => undefined)) ?? '' : '';
    }

    async working(path: string): Promise<string> {
        const uri = this.uriOf(path);
        if (!uri) {
            return '';
        }
        try {
            return (await this.files.read(uri)).value;
        } catch {
            return '';
        }
    }

    async hunks(path: string): Promise<ChangeHunk[]> {
        return changeHunks(await this.base(path), await this.working(path));
    }

    async recentMessages(): Promise<string[]> {
        const root = this.root;
        const fromGit = root ? parseRecentMessages((await this.git.run(root, { kind: 'recentMessages' })).output) : [];
        return [...new Set([...this.history, ...fromGit])].slice(0, 30);
    }

    async headMessage(): Promise<string> {
        const root = this.root;
        return root ? (await this.git.run(root, { kind: 'headMessage' })).output.trim() : '';
    }

    /** Commits the included files (and only the included chunks of partially selected files). */
    async commit(options: CommitOptions): Promise<void> {
        const root = this.root;
        if (!root) {
            throw new Error('Open a project first.');
        }
        await this.commands.executeCommand('core.saveAll');
        const included = this.included;
        if (!included.length && !options.amend) {
            throw new Error('Select files to commit.');
        }
        if (!options.message.trim()) {
            throw new Error('Enter a commit message.');
        }
        const flags = { message: options.message, amend: options.amend, signoff: options.signoff, noVerify: !options.runHooks };
        const untracked = included.filter(e => e.status === 'untracked').map(e => e.path);
        const partial = included.filter(e => e.status === 'modified' && this.excludedHunks.get(e.path)?.size);
        if (!partial.length) {
            if (untracked.length) {
                await this.git.run(root, { kind: 'add', paths: untracked });
            }
            const paths = included.flatMap(e => e.oldPath ? [e.path, e.oldPath] : [e.path]);
            await this.git.run(root, { kind: 'commit', ...flags, paths });
        } else {
            // Build the index from scratch: whole files as they are, partial files with only the chosen chunks.
            await this.git.run(root, { kind: 'resetIndex' });
            const whole = included.filter(e => !partial.includes(e)).flatMap(e => e.oldPath ? [e.path, e.oldPath] : [e.path]);
            if (whole.length) {
                await this.git.run(root, { kind: 'add', paths: whole });
            }
            for (const entry of partial) {
                const content = applySelectedHunks(await this.base(entry.path), await this.working(entry.path),
                    new Set((await this.hunks(entry.path)).map(h => h.index).filter(i => this.isHunkIncluded(entry.path, i))));
                await this.git.run(root, { kind: 'stageContent', path: entry.path, content });
            }
            await this.git.run(root, { kind: 'commit', ...flags });
        }
        this.history = [options.message.trim(), ...this.history.filter(m => m !== options.message.trim())].slice(0, 30);
        included.forEach(e => this.excludedHunks.delete(e.path));
        this.save();
        await this.refresh();
    }
}
