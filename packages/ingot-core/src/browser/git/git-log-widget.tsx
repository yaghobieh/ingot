import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { GIT_LOG_COMMIT_MENU } from './git-actions.consts';
import { GIT_LOG_LIMIT } from '../../common/git/git.consts';
import { GitService, type GitCommit, type GitFileChange } from '../../common/git/git.types';
import { relativeDate } from '../../common/git/git.utils';
import { toGitUri } from './git-resource-resolver';
import { GIT_LOG_WIDGET_ID, GIT_LOG_WIDGET_LABEL } from './git.browser-consts';

/** Git tool window › Log: commits, their changed files, and a diff per file (IDEA-32). */
@injectable()
export class IngotGitLogWidget extends ReactWidget {

    @inject(GitService) protected readonly git: GitService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;

    protected commits: GitCommit[] = [];
    protected selected?: GitCommit;
    protected changes: GitFileChange[] = [];
    protected filter = '';
    protected path?: string;
    protected error?: string;

    @postConstruct()
    protected init(): void {
        this.id = GIT_LOG_WIDGET_ID;
        this.title.label = GIT_LOG_WIDGET_LABEL;
        this.title.caption = GIT_LOG_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-git-commit';
        this.addClass('ingot-git-log');
        this.refresh();
    }

    get selectedHash(): string | undefined {
        return this.selected?.hash;
    }

    get filePath(): string | undefined {
        return this.path;
    }

    get loadedCommits(): readonly GitCommit[] {
        return this.commits;
    }

    /** Selects a commit by hash (Go to Child / Parent) and scrolls it into view. */
    async selectHash(hash: string): Promise<void> {
        const commit = this.commits.find(c => c.hash === hash || c.hash.startsWith(hash));
        if (commit) {
            this.filter = '';
            await this.select(commit);
            this.node.querySelector(`[data-hash="${commit.hash}"]`)?.scrollIntoView({ block: 'nearest' });
        }
    }

    protected async showCommitMenu(event: React.MouseEvent, commit: GitCommit): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        await this.select(commit);
        this.contextMenu.render({ menuPath: GIT_LOG_COMMIT_MENU, anchor: { x: event.clientX, y: event.clientY }, args: [commit.hash], context: this.node });
    }

    protected get root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    /** Shows the whole log, or the history of one repository-relative file. */
    async refresh(path?: string): Promise<void> {
        this.path = path;
        this.selected = undefined;
        this.changes = [];
        const root = this.root;
        try {
            this.commits = root ? await this.git.log(root, GIT_LOG_LIMIT, path) : [];
            this.error = undefined;
        } catch (error) {
            this.commits = [];
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.title.label = path ? `${GIT_LOG_WIDGET_LABEL}: ${path.split('/').pop()}` : GIT_LOG_WIDGET_LABEL;
        this.update();
    }

    protected async select(commit: GitCommit): Promise<void> {
        this.selected = commit;
        this.changes = this.root ? await this.git.changes(this.root, commit.hash) : [];
        this.update();
    }

    protected async openDiff(change: GitFileChange): Promise<void> {
        const root = this.root;
        const commit = this.selected;
        if (!root || !commit) {
            return;
        }
        const left = toGitUri({ root, ref: change.status === 'A' ? '' : `${commit.hash}~1`, path: change.oldPath ?? change.path });
        const right = toGitUri({ root, ref: change.status === 'D' ? '' : commit.hash, path: change.path });
        await open(this.opener, DiffUris.encode(left, right, `${change.path.split('/').pop()} (${commit.short})`));
    }

    protected render(): React.ReactNode {
        const needle = this.filter.toLowerCase();
        const commits = needle ? this.commits.filter(c => `${c.subject} ${c.author} ${c.short}`.toLowerCase().includes(needle)) : this.commits;
        return <div className='ingot-log-root'>
            <div className='ingot-log-list'>
                <div className='ingot-log-toolbar'>
                    <input id='ingot-log-filter' className='theia-input' placeholder='Text or hash' value={this.filter} onChange={e => { this.filter = e.currentTarget.value; this.update(); }} />
                    {this.path && <button type='button' className='theia-button secondary' onClick={() => this.refresh()}>All files</button>}
                    <button type='button' id='ingot-log-refresh' className='theia-button secondary' title='Refresh' onClick={() => this.refresh(this.path)}>↻</button>
                </div>
                {this.error && <div className='ingot-log-empty'>{this.error}</div>}
                {!this.error && commits.length === 0 && <div className='ingot-log-empty'>No commits.</div>}
                {commits.map(c => (
                    <div key={c.hash} data-hash={c.hash} className={`ingot-log-row${this.selected?.hash === c.hash ? ' selected' : ''}`} onClick={() => this.select(c)}
                        onContextMenu={e => this.showCommitMenu(e, c)} title={c.hash}>
                        <span className='ingot-log-subject'>{c.subject}</span>
                        {c.refs.map(r => <span key={r} className='ingot-badge ingot-log-ref'>{r}</span>)}
                        <span className='ingot-log-author'>{c.author}</span>
                        <span className='ingot-log-date' title={c.date}>{relativeDate(c.date)}</span>
                    </div>
                ))}
            </div>
            <div className='ingot-log-details'>
                {this.selected ? <>
                    <div className='ingot-log-commit'><code>{this.selected.short}</code> {this.selected.subject}</div>
                    {this.changes.map(ch => (
                        <div key={ch.path} className={`ingot-log-file ingot-log-file-${ch.status}`} onClick={() => this.openDiff(ch)} title='Show diff'>
                            <span className='ingot-log-status'>{ch.status}</span>{ch.path}
                        </div>
                    ))}
                </> : <div className='ingot-log-empty'>Select a commit to see its changes.</div>}
            </div>
        </div>;
    }
}
