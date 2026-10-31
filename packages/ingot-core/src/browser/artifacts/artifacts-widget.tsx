import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { AgentStore } from '../agents/agent-store';
import { AgentMarkdownRenderer } from '../agents/markdown-renderer';
import { ArtifactService } from './artifact-service';
import { ARTIFACTS_RELOAD_MS, ARTIFACTS_WIDGET_ID, ARTIFACTS_WIDGET_LABEL, COMMENT_PLACEHOLDER } from './artifacts.consts';
import { SCREENSHOTS_DIR } from '../../common/artifacts/artifacts.consts';
import type { ArtifactComment, ArtifactFile, ArtifactRunMeta, MarkdownLine } from '../../common/artifacts/artifacts.types';
import { commentsAt, markdownLines, steeringText } from '../../common/artifacts/artifacts.utils';

const IMAGE_LINE = /^\s*!\[[^\]]*\]\(([^)\s]+)\)\s*$/;

interface CommentTarget {
    readonly file: string;
    readonly line?: number;
    readonly quote: string;
}

/**
 * IDEA-290: the artifacts of an agent run (plan.md, walkthrough.md, screenshots). Any line or image takes an inline
 * comment; the comment is saved next to the artifacts and sent to the run's chat as steering.
 */
@injectable()
export class IngotArtifactsWidget extends ReactWidget {

    @inject(ArtifactService) protected readonly artifacts: ArtifactService;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(MessageService) protected readonly messages: MessageService;

    protected readonly markdown = new AgentMarkdownRenderer(() => this.update());
    protected runs: ArtifactRunMeta[] = [];
    protected runId?: string;
    /** True once the user picked a run, so new runs do not take the view away. */
    protected pinnedRun = false;
    protected files: ArtifactFile[] = [];
    protected fileName?: string;
    protected lines: MarkdownLine[] = [];
    protected images = new Map<string, string>();
    protected comments: ArtifactComment[] = [];
    protected target?: CommentTarget;
    protected draft = '';
    protected reloadTimer?: ReturnType<typeof setTimeout>;

    @postConstruct()
    protected init(): void {
        this.id = ARTIFACTS_WIDGET_ID;
        this.title.label = ARTIFACTS_WIDGET_LABEL;
        this.title.caption = 'Plans, walkthroughs and screenshots from agent runs';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-notebook';
        this.addClass('ingot-artifacts');
        this.node.tabIndex = 0;
        this.toDispose.push(this.artifacts.onDidChange(() => this.scheduleReload()));
        this.toDispose.push({ dispose: () => clearTimeout(this.reloadTimer) });
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.reload();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected scheduleReload(): void {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.reload(), ARTIFACTS_RELOAD_MS);
    }

    /** Shows a run (newest when none is given) and one of its files. */
    async openRun(runId?: string, file?: string): Promise<void> {
        if (runId) {
            this.runId = runId;
            this.pinnedRun = true;
            this.fileName = file;
        }
        await this.reload();
    }

    async reload(): Promise<void> {
        this.runs = await this.artifacts.listRuns();
        if (!this.runId || !this.runs.some(r => r.runId === this.runId) || (!this.pinnedRun && this.runs[0]?.runId !== this.runId)) {
            this.runId = this.runs[0]?.runId;
            this.fileName = undefined;
        }
        const runId = this.runId;
        this.files = runId ? await this.artifacts.listFiles(runId) : [];
        if (!this.fileName || !this.files.some(f => f.name === this.fileName && f.kind === 'markdown')) {
            this.fileName = this.files.find(f => f.kind === 'markdown')?.name;
        }
        this.lines = runId && this.fileName ? markdownLines(await this.artifacts.readText(runId, this.fileName)) : [];
        const shots = this.files.filter(f => f.kind === 'image');
        this.images = new Map(runId ? await Promise.all(shots.map(async s => [s.name, await this.artifacts.imageUrl(runId, s.name) ?? ''] as const)) : []);
        this.comments = runId ? await this.artifacts.comments(runId) : [];
        this.update();
    }

    protected selectRun(runId: string): void {
        this.runId = runId;
        this.pinnedRun = true;
        this.fileName = undefined;
        this.target = undefined;
        void this.reload();
    }

    protected selectFile(name: string): void {
        this.fileName = name;
        this.target = undefined;
        void this.reload();
    }

    protected openComposer(target: CommentTarget): void {
        this.target = target;
        this.draft = '';
        this.update();
        requestAnimationFrame(() => this.node.querySelector<HTMLTextAreaElement>('.ingot-art-composer textarea')?.focus());
    }

    protected cancelComment(): void {
        this.target = undefined;
        this.draft = '';
        this.update();
    }

    /** Saves the comment and sends it to the run's chat (steering when it is running, a new turn when idle). */
    async submitComment(): Promise<void> {
        const target = this.target;
        const run = this.runs.find(r => r.runId === this.runId);
        const text = this.draft.trim();
        if (!target || !run || !text) {
            return;
        }
        const base = { id: `c-${Date.now().toString(36)}-${this.comments.length}`, file: target.file, quote: target.quote, text, at: Date.now(), ...(target.line ? { line: target.line } : {}) };
        const delivered = run.sessionId ? this.store.steer(run.sessionId, steeringText(base)) : undefined;
        const comment: ArtifactComment = { ...base, sent: !!delivered };
        this.comments = [...this.comments, comment];
        this.target = undefined;
        this.draft = '';
        this.update();
        await this.artifacts.saveComments(run.runId, this.comments);
        if (!delivered) {
            this.messages.info('The chat of this run is gone. The comment was saved with the artifacts.');
        }
    }

    protected renderComments(file: string, line?: number): React.ReactNode {
        const list = commentsAt(this.comments, file, line);
        const composing = this.target?.file === file && this.target.line === line;
        if (!list.length && !composing) {
            return undefined;
        }
        return <div className='ingot-art-thread'>
            {list.map(c => <div key={c.id} className='ingot-art-comment' data-comment={c.id}>
                <span className='codicon codicon-comment' aria-hidden='true' />
                <span className='ingot-art-comment-text'>{c.text}</span>
                <span className={`ingot-art-comment-state${c.sent ? ' sent' : ''}`}>{c.sent ? 'Sent to agent' : 'Saved'}</span>
            </div>)}
            {composing && <div className='ingot-art-composer'>
                <textarea className='theia-input' rows={2} placeholder={COMMENT_PLACEHOLDER} value={this.draft} aria-label='Comment for the agent'
                    onChange={e => { this.draft = e.currentTarget.value; this.update(); }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void this.submitComment();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            this.cancelComment();
                        }
                    }} />
                <div className='ingot-art-composer-actions'>
                    <button type='button' className='ingot-art-btn' onClick={() => this.cancelComment()}>Cancel</button>
                    <button type='button' className='ingot-art-btn primary' id='ingot-art-send' disabled={!this.draft.trim()} onClick={() => void this.submitComment()}>Send to agent</button>
                </div>
            </div>}
        </div>;
    }

    protected renderLine(file: string, line: MarkdownLine): React.ReactNode {
        const image = IMAGE_LINE.exec(line.text)?.[1];
        const src = image?.startsWith(`${SCREENSHOTS_DIR}/`) ? this.images.get(image) : undefined;
        const count = commentsAt(this.comments, file, line.line).length;
        return <React.Fragment key={line.line}>
            <div className={`ingot-art-line${line.code ? ' code' : ''}${count ? ' has-comments' : ''}`} data-line={line.line}>
                <button type='button' className='ingot-art-add' title='Comment on this line' aria-label={`Comment on line ${line.line}`}
                    onClick={() => this.openComposer({ file, line: line.line, quote: line.text })}>
                    <span className='codicon codicon-add' />
                </button>
                <span className='ingot-art-num'>{line.line}</span>
                {src
                    ? <img className='ingot-art-inline-image' src={src} alt={image} />
                    : line.code || !line.text.trim()
                        ? <code className='ingot-art-text'>{line.text || ' '}</code>
                        : <div className='ingot-art-text ingot-md' dangerouslySetInnerHTML={{ __html: this.markdown.render(line.text) }} />}
            </div>
            {this.renderComments(file, line.line)}
        </React.Fragment>;
    }

    protected renderImages(): React.ReactNode {
        const shots = this.files.filter(f => f.kind === 'image');
        if (!shots.length) {
            return undefined;
        }
        return <section className='ingot-art-shots' aria-label='Screenshots'>
            <h3 className='ingot-art-heading'>Screenshots</h3>
            {shots.map(shot => <figure key={shot.name} className='ingot-art-shot' data-image={shot.name}>
                <img src={this.images.get(shot.name)} alt={shot.name} />
                <figcaption>
                    <span>{shot.name.slice(SCREENSHOTS_DIR.length + 1)}</span>
                    <span className='ingot-flex' />
                    <button type='button' className='ingot-art-btn' aria-label={`Comment on ${shot.name}`} onClick={() => this.openComposer({ file: shot.name, quote: shot.name })}>
                        <span className='codicon codicon-comment' /> Comment
                    </button>
                </figcaption>
                {this.renderComments(shot.name)}
            </figure>)}
        </section>;
    }

    protected render(): React.ReactNode {
        if (!this.runs.length) {
            return <div className='ingot-art-root'>
                <div className='ingot-art-empty' id='ingot-art-empty'>
                    <span className='codicon codicon-notebook' />
                    <p>No artifacts yet. When an agent plans a change, takes screenshots or finishes one, its plan.md, walkthrough.md and screenshots show up here.</p>
                </div>
            </div>;
        }
        const run = this.runs.find(r => r.runId === this.runId);
        const session = run?.sessionId ? this.store.find(run.sessionId) : undefined;
        const running = !!session && this.store.isRunning(session.id);
        const markdownFiles = this.files.filter(f => f.kind === 'markdown');
        return <div className='ingot-art-root'>
            <div className='ingot-art-toolbar'>
                <select className='theia-select ingot-art-runs' id='ingot-art-runs' aria-label='Run' value={this.runId} onChange={e => this.selectRun(e.currentTarget.value)}>
                    {this.runs.map(r => <option key={r.runId} value={r.runId}>{r.title} · {new Date(r.startedAt).toLocaleString()}</option>)}
                </select>
                <span className={`ingot-art-status${running ? ' running' : ''}`} id='ingot-art-status'>{running ? 'Agent running: comments steer it' : session ? 'Agent idle: a comment starts a new turn' : 'Chat closed'}</span>
                <span className='ingot-flex' />
                <button type='button' className='ingot-art-icon' title='Refresh' aria-label='Refresh artifacts' onClick={() => void this.reload()}>
                    <span className='codicon codicon-refresh' />
                </button>
            </div>
            <div className='ingot-art-tabs' role='tablist'>
                {markdownFiles.map(f => <button key={f.name} type='button' role='tab' aria-selected={f.name === this.fileName}
                    className={`ingot-art-tab${f.name === this.fileName ? ' active' : ''}`} data-file={f.name} onClick={() => this.selectFile(f.name)}>
                    <span className='codicon codicon-markdown' />{f.name}
                </button>)}
            </div>
            <div className='ingot-art-body'>
                {this.fileName && <div className='ingot-art-doc' data-file={this.fileName}>{this.lines.map(line => this.renderLine(this.fileName!, line))}</div>}
                {this.renderImages()}
            </div>
        </div>;
    }
}
