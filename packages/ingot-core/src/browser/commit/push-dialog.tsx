import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { Message } from '@theia/core/lib/browser/widgets';
import type { GitCommit, GitFileChange, GitService } from '../../common/git/git.types';
import { parseLog } from '../../common/git/git.utils';
import { parseRemotes, type PushTags } from '../../common/git/git-ops';
import { splitPath } from '../../common/git/changes';

export interface PushRequest {
    readonly remote: string;
    readonly localBranch: string;
    readonly remoteBranch: string;
    readonly tags: PushTags;
    readonly force: boolean;
    readonly setUpstream: boolean;
}

export interface PushDialogDeps {
    readonly git: GitService;
    readonly root: string;
    readonly repoName: string;
    readonly openCommitFileDiff: (commit: GitCommit, change: GitFileChange) => void;
    readonly confirmForce: (target: string) => Promise<boolean>;
}

/**
 * Push dialog (IDEA-74, ⇧⌘K and after Commit and Push…): branch row "local → origin : remote" with an editable
 * target and a New badge, outgoing commits, files of the selected commit, tag and force-with-lease options.
 */
export class PushDialog extends ReactDialog<PushRequest | undefined> {

    protected branch = '';
    protected remotes: string[] = [];
    protected remote = 'origin';
    protected remoteBranch = '';
    protected editingTarget = false;
    protected remoteExists = true;
    protected hasUpstream = false;
    protected commits: GitCommit[] = [];
    protected selected: GitCommit | undefined;
    protected files: GitFileChange[] = [];
    protected tags: PushTags = 'none';
    protected force = false;
    protected menuOpen = false;
    protected loading = true;
    protected error = '';
    protected result: PushRequest | undefined;

    constructor(protected readonly deps: PushDialogDeps) {
        super({ title: `Push Commits to ${deps.repoName}` });
        this.node.classList.add('ingot-push-dialog');
        this.load();
    }

    get value(): PushRequest | undefined {
        return this.result;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.update();
    }

    protected async load(): Promise<void> {
        const { git, root } = this.deps;
        try {
            this.branch = (await git.run(root, { kind: 'currentBranch' })).output.trim();
            this.remotes = parseRemotes((await git.run(root, { kind: 'remotes' })).output).map(r => r.name);
            const upstream = (await git.run(root, { kind: 'upstream' })).output.trim();
            this.hasUpstream = !!upstream && upstream.includes('/');
            if (this.hasUpstream) {
                this.remote = upstream.slice(0, upstream.indexOf('/'));
                this.remoteBranch = upstream.slice(upstream.indexOf('/') + 1);
            } else {
                this.remote = this.remotes.includes('origin') ? 'origin' : this.remotes[0] ?? 'origin';
                this.remoteBranch = this.branch;
            }
            await this.loadCommits();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.loading = false;
        this.update();
    }

    protected async loadCommits(): Promise<void> {
        const { git, root } = this.deps;
        const target = `${this.remote}/${this.remoteBranch}`;
        this.remoteExists = await git.run(root, { kind: 'revParse', ref: target }).then(() => true, () => false);
        this.commits = parseLog((await git.run(root, this.remoteExists ? { kind: 'outgoing', remoteRef: target } : { kind: 'outgoing' })).output);
        await this.selectCommit(this.commits[0]);
    }

    protected async selectCommit(commit: GitCommit | undefined): Promise<void> {
        this.selected = commit;
        this.files = commit ? await this.deps.git.changes(this.deps.root, commit.hash).catch(() => []) : [];
        this.update();
    }

    protected async setTarget(value: string): Promise<void> {
        this.editingTarget = false;
        const trimmed = value.trim();
        if (trimmed && trimmed !== this.remoteBranch) {
            this.remoteBranch = trimmed;
            await this.loadCommits();
        }
        this.update();
    }

    protected async push(force: boolean): Promise<void> {
        this.menuOpen = false;
        if (force && !await this.deps.confirmForce(`${this.remote}/${this.remoteBranch}`)) {
            this.update();
            return;
        }
        this.result = {
            remote: this.remote, localBranch: this.branch, remoteBranch: this.remoteBranch,
            tags: this.tags, force: force || this.force, setUpstream: !this.hasUpstream
        };
        this.accept();
    }

    protected render(): React.ReactNode {
        const canPush = !this.loading && !!this.branch && this.branch !== 'HEAD' && this.remotes.length > 0;
        return <div className='ingot-push'>
            <div className='ingot-push-body'>
                <div className='ingot-push-left'>
                    <div className='ingot-push-branch' id='ingot-push-branch'>
                        <span className='codicon codicon-git-branch' />
                        <span className='ingot-push-local'>{this.branch || '…'}</span>
                        <span className='ingot-push-arrow'>→</span>
                        <select className='ingot-select ingot-push-remote' aria-label='Remote' value={this.remote}
                            onChange={async e => { this.remote = e.currentTarget.value; await this.loadCommits(); }}>
                            {(this.remotes.length ? this.remotes : [this.remote]).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <span>:</span>
                        {this.editingTarget
                            ? <input id='ingot-push-target-input' className='ingot-input ingot-push-target-input' autoFocus defaultValue={this.remoteBranch}
                                onBlur={e => this.setTarget(e.currentTarget.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.setTarget(e.currentTarget.value); } if (e.key === 'Escape') { e.stopPropagation(); this.editingTarget = false; this.update(); } }} />
                            : <button type='button' id='ingot-push-target' className='ingot-push-target' title='Click to edit the target branch'
                                onClick={() => { this.editingTarget = true; this.update(); }}>{this.remoteBranch || '…'}</button>}
                        {!this.remoteExists && !this.loading && <span className='ingot-push-new' id='ingot-push-new'>New</span>}
                    </div>
                    <div className='ingot-push-commits' role='listbox' aria-label='Commits to push'>
                        {this.loading && <div className='ingot-lc-empty'>Loading…</div>}
                        {this.error && <div className='ingot-lc-empty'>{this.error}</div>}
                        {!this.loading && !this.error && this.commits.length === 0 && <div className='ingot-lc-empty'>Nothing to push.</div>}
                        {this.commits.map(c => (
                            <div key={c.hash} role='option' aria-selected={this.selected?.hash === c.hash}
                                className={`ingot-push-commit ${this.selected?.hash === c.hash ? 'selected' : ''}`} onClick={() => this.selectCommit(c)}>
                                <span className='ingot-push-subject'>{c.subject}</span>
                                <span className='ingot-push-meta'>{c.short} · {c.author}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className='ingot-push-right' aria-label='Changed files'>
                    {this.selected && <div className='ingot-push-files-title'>{this.files.length} file{this.files.length === 1 ? '' : 's'} in {this.selected.short}</div>}
                    {this.files.map(f => {
                        const { dir, name } = splitPath(f.path);
                        return <div key={f.path} className='ingot-push-file' title={f.path} onDoubleClick={() => this.selected && this.deps.openCommitFileDiff(this.selected, f)}>
                            <span className={`ingot-lc-name ingot-push-status-${f.status}`}>{name}</span>
                            {dir && <span className='ingot-lc-dir'>{dir}</span>}
                        </div>;
                    })}
                </div>
            </div>
            <div className='ingot-push-footer'>
                <label>Push tags:
                    <select id='ingot-push-tags' className='ingot-select' value={this.tags} onChange={e => { this.tags = e.currentTarget.value as PushTags; this.update(); }}>
                        <option value='none'>None</option>
                        <option value='current'>Current branch</option>
                        <option value='all'>All</option>
                    </select>
                </label>
                <label><input type='checkbox' id='ingot-push-force' checked={this.force} onChange={e => { this.force = e.currentTarget.checked; this.update(); }} /> Force push (with lease)</label>
                <span className='ingot-flex' />
                <button type='button' id='ingot-push-cancel' className='theia-button secondary' onClick={() => this.close()}>Cancel</button>
                <div className='ingot-lc-split'>
                    <button type='button' id='ingot-push-button' className='ingot-btn-primary' disabled={!canPush} onClick={() => this.push(false)}>{this.force ? 'Force Push' : 'Push'}</button>
                    <button type='button' id='ingot-push-menu' className='ingot-btn-primary ingot-lc-commit-arrow' aria-label='More push actions' disabled={!canPush}
                        onClick={() => { this.menuOpen = !this.menuOpen; this.update(); }}><span className='codicon codicon-chevron-down' /></button>
                    {this.menuOpen && <div className='ingot-lc-popup ingot-lc-popup-up' role='menu'>
                        <button type='button' role='menuitem' id='ingot-push-force-push' onClick={() => this.push(true)}>Force Push</button>
                    </div>}
                </div>
            </div>
        </div>;
    }
}
