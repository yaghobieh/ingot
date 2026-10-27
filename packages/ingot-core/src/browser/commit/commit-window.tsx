import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Widget } from '@theia/core/lib/browser/widgets';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { splitPath, STATUS_LABEL, type ChangeEntry } from '../../common/git/changes';
import { newFileDiff } from '../../common/git/ai-commit';
import { GitService } from '../../common/git/git.types';
import { badgeClasses } from '../../common/icons/file-icons.utils';
import { AiCommitButton, AiCommitError, AiMessageController } from './ai-commit-button';
import { AgentHooksGate } from '../hooks/hooks-contribution';
import { AiCommitService } from './ai-commit-service';
import { COMMIT_COMMANDS, COMMIT_WINDOW_ID, LOCAL_CHANGES_WIDGET_ID } from './commit.consts';
import { LocalChangesModel } from './local-changes-model';
import type { LocalChangesWidget } from './local-changes-widget';

const STATUS_LETTER: Record<ChangeEntry['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', conflicted: '!', untracked: 'U' };
const MAX_PREVIEW_CHARS = 200_000;
const MIN_W = 560;
const MIN_H = 380;

/**
 * IDEA-176: the Commit tool window as a floating window over the workbench (moveable, resizable, non-modal):
 * staged / unstaged files with stage and unstage, a diff preview of the clicked file, the commit message with
 * Commit with AI, and Commit / Commit and Push. Shares the Local Changes model with the docked view.
 */
@injectable()
export class CommitWindow extends ReactWidget {

    @inject(LocalChangesModel) readonly model: LocalChangesModel;
    @inject(AiCommitService) protected readonly aiService: AiCommitService;
    @inject(AgentHooksGate) protected readonly hooksGate: AgentHooksGate;
    @inject(GitService) protected readonly git: GitService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;

    message = '';
    amend = false;
    selected: string | undefined;
    protected diff = '';
    protected diffLoading = false;
    protected busy = false;
    protected placed = false;
    protected messageInput: HTMLTextAreaElement | null = null;
    ai: AiMessageController;

    @postConstruct()
    protected init(): void {
        this.id = COMMIT_WINDOW_ID;
        this.title.label = 'Commit';
        this.addClass('ingot-commit-window');
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-label', 'Commit window');
        this.node.tabIndex = -1;
        this.ai = new AiMessageController(this.aiService, () => this.message, m => { this.message = m; }, () => this.update());
        this.toDispose.push({ dispose: () => this.ai.dispose() });
        this.toDispose.push(this.model.onDidChange(() => this.onModelChange()));
        // The workbench handles keys in the capture phase on document, so Escape is caught on window first.
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape' && this.isAttached && this.node.contains(document.activeElement)) {
                e.preventDefault();
                e.stopPropagation();
                if (this.ai.generating) {
                    this.ai.toggle();
                } else {
                    this.close();
                }
            }
        };
        window.addEventListener('keydown', onKey, true);
        this.toDispose.push({ dispose: () => window.removeEventListener('keydown', onKey, true) });
    }

    /** Hides the window but keeps it (and its message) for the next open; the workbench default would dispose it. */
    override close(): void {
        this.ai.dispose();
        if (this.isAttached) {
            Widget.detach(this);
        }
    }

    get isOpen(): boolean {
        return this.isAttached;
    }

    /** Shows the window (centered the first time, then where the user left it) and focuses the message. */
    async open(): Promise<void> {
        if (!this.isAttached) {
            Widget.attach(this, document.body);
        }
        if (!this.placed) {
            const w = Math.min(920, Math.max(MIN_W, window.innerWidth - 120));
            const h = Math.min(620, Math.max(MIN_H, window.innerHeight - 140));
            Object.assign(this.node.style, { width: `${w}px`, height: `${h}px`, left: `${Math.round((window.innerWidth - w) / 2)}px`, top: `${Math.round((window.innerHeight - h) / 2.4)}px` });
            this.placed = true;
        }
        this.update();
        await this.model.refresh();
        if (!this.selected && this.model.entries[0]) {
            await this.select(this.model.entries[0].path);
        }
        (this.messageInput ?? this.node).focus();
    }

    protected onModelChange(): void {
        if (this.selected && !this.model.entries.some(e => e.path === this.selected)) {
            this.selected = undefined;
            this.diff = '';
        }
        this.update();
    }

    async select(path: string): Promise<void> {
        this.selected = path;
        this.diffLoading = true;
        this.update();
        const entry = this.model.entries.find(e => e.path === path);
        const root = this.model.root;
        try {
            if (!entry || !root) {
                this.diff = '';
            } else if (entry.status === 'untracked') {
                this.diff = newFileDiff(path, (await this.model.working(path)).slice(0, MAX_PREVIEW_CHARS));
            } else {
                const paths = entry.oldPath ? [entry.path, entry.oldPath] : [entry.path];
                this.diff = (await this.git.run(root, { kind: 'diff', paths })).output.slice(0, MAX_PREVIEW_CHARS);
            }
        } catch (error) {
            this.diff = `Could not load the diff: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            if (this.selected === path) {
                this.diffLoading = false;
                this.update();
            }
        }
    }

    protected startDrag(e: React.MouseEvent): void {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) {
            return;
        }
        e.preventDefault();
        const rect = this.node.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const move = (ev: MouseEvent): void => {
            const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - 80);
            const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40);
            this.node.style.left = `${left}px`;
            this.node.style.top = `${top}px`;
        };
        const up = (): void => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            this.node.classList.remove('dragging');
        };
        this.node.classList.add('dragging');
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }

    protected async dock(): Promise<void> {
        await this.commands.executeCommand(COMMIT_COMMANDS.commit.id);
        const docked = this.widgets.tryGetWidget<LocalChangesWidget>(LOCAL_CHANGES_WIDGET_ID);
        if (docked && this.message.trim() && !docked.message.trim()) {
            docked.message = this.message;
            docked.update();
        }
        this.close();
    }

    async commit(andPush: boolean): Promise<boolean> {
        this.busy = true;
        this.update();
        let ok = false;
        try {
            const count = this.model.included.length;
            await this.model.commit({ message: this.message, amend: this.amend, signoff: false, runHooks: true, gate: root => this.hooksGate.gate(root, 'pre-commit') });
            this.messages.info(this.amend ? 'Amended the last commit.' : `Committed ${count} file${count === 1 ? '' : 's'}.`);
            this.message = '';
            this.amend = false;
            ok = true;
        } catch (error) {
            this.messages.error(`Commit failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.busy = false;
            this.update();
        }
        if (ok && andPush) {
            await this.commands.executeCommand(COMMIT_COMMANDS.push.id);
        }
        return ok;
    }

    protected renderRow(entry: ChangeEntry, staged: boolean): React.ReactNode {
        const { dir, name } = splitPath(entry.path);
        const selected = this.selected === entry.path;
        const action = staged ? 'Unstage' : 'Stage';
        return <div key={entry.path} className={`ingot-cw-row${selected ? ' selected' : ''}`} role='option' aria-selected={selected} data-path={entry.path}
            title={`${entry.path} — ${STATUS_LABEL[entry.status]}`} onClick={() => this.select(entry.path)}>
            <span className={`ingot-lc-badge ${badgeClasses(name, false)}`} />
            <span className={`ingot-cw-name ingot-lc-${entry.status}`}>{name}</span>
            {dir && <span className='ingot-cw-dir'>{dir}</span>}
            <span className='ingot-flex' />
            <span className={`ingot-cw-status ingot-cw-status-${entry.status}`} aria-label={STATUS_LABEL[entry.status]}>{STATUS_LETTER[entry.status]}</span>
            <button type='button' className={`ingot-cw-stage codicon codicon-${staged ? 'remove' : 'add'}`} title={`${action} (${staged ? 'leave out of' : 'include in'} the commit)`}
                aria-label={`${action} ${entry.path}`} onClick={e => { e.stopPropagation(); this.model.setChecked([entry.path], !staged); }} />
        </div>;
    }

    protected renderSection(id: string, label: string, entries: ChangeEntry[], staged: boolean): React.ReactNode {
        return <div className='ingot-cw-section' id={`ingot-cw-${id}`} role='listbox' aria-label={label}>
            <div className='ingot-cw-section-head'>
                <span className='ingot-cw-section-name'>{label}</span>
                <span className='ingot-cw-count'>{entries.length}</span>
                <span className='ingot-flex' />
                {entries.length > 0 && <button type='button' id={`ingot-cw-${staged ? 'unstage' : 'stage'}-all`} className='ingot-cw-link'
                    onClick={() => this.model.setChecked(entries.map(e => e.path), !staged)}>{staged ? 'Unstage all' : 'Stage all'}</button>}
            </div>
            {entries.map(e => this.renderRow(e, staged))}
            {!entries.length && <div className='ingot-cw-empty'>{staged ? 'Nothing staged. Stage files to commit them.' : 'No other changes.'}</div>}
        </div>;
    }

    protected renderDiff(): React.ReactNode {
        if (!this.selected) {
            return <div className='ingot-cw-empty ingot-cw-diff-empty'>Select a file to see its changes.</div>;
        }
        if (this.diffLoading) {
            return <div className='ingot-cw-empty ingot-cw-diff-empty'>Loading diff…</div>;
        }
        const lines = this.diff.split('\n').filter((l, i) => i > 0 || l.trim());
        const body = lines.filter(l => !/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l));
        if (!body.length) {
            return <div className='ingot-cw-empty ingot-cw-diff-empty'>No text changes to show.</div>;
        }
        return <pre className='ingot-cw-diff-text'>{body.map((line, i) => {
            const kind = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
            return <div key={i} className={`ingot-cw-line ingot-cw-${kind}`}>{line || ' '}</div>;
        })}</pre>;
    }

    protected render(): React.ReactNode {
        const staged = this.model.included;
        const unstaged = this.model.entries.filter(e => !this.model.isChecked(e));
        const canCommit = !this.busy && !this.ai.generating && (staged.length > 0 || this.amend) && !!this.message.trim();
        const repo = this.model.rootUri?.path.base ?? '';
        return <div className='ingot-cw-root'>
            <div className='ingot-cw-header' onMouseDown={e => this.startDrag(e)}>
                <span className='codicon codicon-git-commit ingot-cw-icon' />
                <span className='ingot-cw-title'>Commit</span>
                {repo && <span className='ingot-cw-sub'>{repo}</span>}
                {this.model.branch && <span className='ingot-cw-branch' title='Current branch'><span className='codicon codicon-git-branch' />{this.model.branch}</span>}
                <span className='ingot-flex' />
                <button type='button' id='ingot-cw-refresh' className='ingot-cw-tool codicon codicon-refresh' title='Refresh' aria-label='Refresh' onClick={() => this.model.refresh()} />
                <button type='button' id='ingot-cw-dock' className='ingot-cw-tool codicon codicon-layout-sidebar-left' title='Dock in the side bar' aria-label='Dock in the side bar' onClick={() => this.dock()} />
                <button type='button' id='ingot-cw-close' className='ingot-cw-tool codicon codicon-close' title='Close (Esc)' aria-label='Close' onClick={() => this.close()} />
            </div>
            <div className='ingot-cw-body'>
                <div className='ingot-cw-files'>
                    {this.model.error && <div className='ingot-cw-empty'>{this.model.error}</div>}
                    {!this.model.error && !this.model.entries.length && <div className='ingot-cw-empty'>{this.model.loading ? 'Loading…' : 'No local changes.'}</div>}
                    {this.model.entries.length > 0 && <>
                        {this.renderSection('staged', 'Staged', staged, true)}
                        {this.renderSection('changes', 'Changes', unstaged, false)}
                    </>}
                </div>
                <div className='ingot-cw-diff' id='ingot-cw-diff' aria-label='Diff preview'>
                    {this.selected && <div className='ingot-cw-diff-head'>
                        <span className='ingot-cw-diff-path'>{this.selected}</span>
                        <span className='ingot-flex' />
                        <button type='button' id='ingot-cw-open-diff' className='ingot-cw-link' onClick={() => this.commands.executeCommand(COMMIT_COMMANDS.showDiff.id, this.selected)}>Open in diff viewer</button>
                    </div>}
                    {this.renderDiff()}
                </div>
            </div>
            <div className='ingot-cw-commit'>
                <div className='ingot-cw-message'>
                    <textarea id='ingot-cw-message' ref={el => { this.messageInput = el; }} placeholder={this.amend ? 'Amend commit message' : 'Commit message'} value={this.message} spellCheck
                        readOnly={this.ai.generating} aria-busy={this.ai.generating}
                        onChange={e => { this.message = e.currentTarget.value; this.update(); }}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) { e.preventDefault(); this.commit(false); } }} />
                    <div className='ingot-cw-message-tools'><AiCommitButton id='ingot-cw-ai' controller={this.ai} /></div>
                </div>
                <AiCommitError id='ingot-cw-ai-error' controller={this.ai} />
                <div className='ingot-cw-actions'>
                    <label className='ingot-cw-amend'><input type='checkbox' id='ingot-cw-amend' checked={this.amend}
                        onChange={async e => { this.amend = e.currentTarget.checked; if (this.amend && !this.message.trim()) { this.message = await this.model.headMessage(); } this.update(); }} /> Amend</label>
                    <span className='ingot-flex' />
                    <span className='ingot-cw-summary' id='ingot-cw-summary'>{staged.length} of {this.model.entries.length} file{this.model.entries.length === 1 ? '' : 's'} staged</span>
                    <button type='button' id='ingot-cw-commit-push' className='ingot-cw-btn' disabled={!canCommit} title='Commit, then open Push (⇧⌘K)' onClick={() => this.commit(true)}>Commit and Push…</button>
                    <button type='button' id='ingot-cw-commit' className='ingot-cw-btn primary' disabled={!canCommit} title='Commit (⌘↩)' onClick={() => this.commit(false)}>{this.amend ? 'Amend Commit' : 'Commit'}</button>
                </div>
            </div>
        </div>;
    }
}
