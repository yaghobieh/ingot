import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { nextOpenTask, SPEC_DOC_FILES, SPEC_DOC_LABELS, SPEC_DOCS } from '../../common/ingot-kit';
import type { SpecDoc, SpecSummary, SpecTask } from '../../common/ingot-kit';
import { SpecsService } from './specs-service';
import { SpecTaskRunner } from './specs.types';
import { PERCENT, SPECS_COMMANDS, SPECS_FOCUS_KEY, SPECS_TEXT, SPECS_WIDGET_ID, SPECS_WIDGET_LABEL } from './specs.consts';

/** IDEA-324: Specs tool window: every spec's progress, its three docs, and its tasks (tick off or run with the agent). */
@injectable()
export class IngotSpecsWidget extends ReactWidget {

    @inject(SpecsService) protected readonly specs: SpecsService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(SpecTaskRunner) protected readonly runner: SpecTaskRunner;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    protected focusKey?: ContextKey<boolean>;

    protected items: SpecSummary[] = [];
    protected loaded = false;
    protected collapsed = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = SPECS_WIDGET_ID;
        this.title.label = SPECS_WIDGET_LABEL;
        this.title.caption = SPECS_TEXT.caption;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-checklist';
        this.addClass('ingot-specs');
        this.node.tabIndex = 0;
        this.toDispose.push(this.specs.onDidChange(() => this.refresh()));
        this.focusKey = this.contextKeys.createKey<boolean>(SPECS_FOCUS_KEY, false);
        this.node.addEventListener('focusin', () => this.focusKey?.set(true));
        this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget as Node | null)) { this.focusKey?.set(false); } });
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refresh();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    async refresh(): Promise<void> {
        this.items = await this.specs.list();
        this.loaded = true;
        this.update();
    }

    protected async openDoc(spec: SpecSummary, doc: SpecDoc): Promise<void> {
        const uri = this.specs.docUri(spec.slug, doc);
        if (uri) {
            await open(this.opener, uri);
        }
    }

    protected async toggle(spec: SpecSummary, task: SpecTask): Promise<void> {
        await this.specs.setDone(spec.slug, task.id, !task.done);
        await this.refresh();
    }

    protected toggleCollapsed(slug: string): void {
        if (this.collapsed.has(slug)) {
            this.collapsed.delete(slug);
        } else {
            this.collapsed.add(slug);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        const hasProject = !!this.specs.root();
        return <div className='ingot-specs-root'>
            <div className='ingot-dot-toolbar'>
                <span className='ingot-dot-title'>{SPECS_WIDGET_LABEL}</span>
                <span className='ingot-beta-pill'>{SPECS_TEXT.beta}</span>
                <span className='ingot-dot-spacer' />
                <button type='button' id='ingot-specs-new' className='ingot-dot-button' disabled={!hasProject}
                    onClick={() => this.commands.executeCommand(SPECS_COMMANDS.create.id)}>
                    <span className='codicon codicon-add' /> {SPECS_TEXT.create}
                </button>
                <button type='button' className='ingot-dot-iconbtn' title={SPECS_TEXT.refresh} aria-label={SPECS_TEXT.refresh} onClick={() => this.refresh()}>
                    <span className='codicon codicon-refresh' />
                </button>
            </div>
            {!hasProject && <div className='ingot-dot-empty'>{SPECS_TEXT.noProject}</div>}
            {hasProject && this.loaded && !this.items.length && <div className='ingot-dot-empty' id='ingot-specs-empty'>{SPECS_TEXT.empty}</div>}
            {this.items.map(spec => this.renderSpec(spec))}
        </div>;
    }

    protected renderSpec(spec: SpecSummary): React.ReactNode {
        const { done, total } = spec.progress;
        const next = nextOpenTask(spec.tasks);
        const open = !this.collapsed.has(spec.slug);
        return <section key={spec.slug} className='ingot-spec' data-spec={spec.slug}>
            <header className='ingot-spec-header'>
                <button type='button' className='ingot-dot-iconbtn' aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${spec.title}`} onClick={() => this.toggleCollapsed(spec.slug)}>
                    <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
                </button>
                <span className='ingot-spec-title'>{spec.title}</span>
                <span className='ingot-spec-count'>{done}/{total}</span>
            </header>
            <div className='ingot-spec-progress' role='progressbar' aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
                <span style={{ width: `${total ? Math.round(done / total * PERCENT) : 0}%` }} />
            </div>
            {open && <>
                <div className='ingot-spec-docs'>
                    {SPEC_DOCS.map(doc => <button type='button' key={doc} className={`ingot-spec-doc ${spec.docs.includes(doc) ? '' : 'missing'}`}
                        title={`${spec.dir}/${SPEC_DOC_FILES[doc]}${spec.docs.includes(doc) ? '' : ` (${SPECS_TEXT.docMissing})`}`} onClick={() => this.openDoc(spec, doc)}>
                        <span className='codicon codicon-markdown' /> {SPEC_DOC_LABELS[doc]}
                    </button>)}
                </div>
                {!spec.tasks.length && <div className='ingot-dot-muted'>{SPECS_TEXT.noTasks}</div>}
                <ul className='ingot-spec-tasks'>
                    {spec.tasks.map(task => this.renderTask(spec, task))}
                </ul>
                <div className='ingot-spec-footer'>
                    {next
                        ? <button type='button' className='ingot-dot-button primary ingot-spec-run-next' onClick={() => this.runner.runTask(spec, next)}>
                            <span className='codicon codicon-play' /> {SPECS_TEXT.runNext}: {next.id}
                        </button>
                        : spec.tasks.length > 0 && <span className='ingot-dot-ok'><span className='codicon codicon-pass' /> {SPECS_TEXT.allDone}</span>}
                </div>
            </>}
        </section>;
    }

    protected renderTask(spec: SpecSummary, task: SpecTask): React.ReactNode {
        const leaf = !spec.tasks.some(other => other.id.startsWith(`${task.id}.`));
        return <li key={`${task.id}-${task.line}`} className={`ingot-spec-task ${task.done ? 'done' : ''}`} data-task={task.id} style={{ paddingLeft: `${task.depth * 14 + 4}px` }}>
            <input type='checkbox' checked={task.done} aria-label={`Task ${task.id}: ${task.title}`} onChange={() => this.toggle(spec, task)} />
            <span className='ingot-spec-task-id'>{task.id}</span>
            <span className='ingot-spec-task-title'>{task.title}</span>
            {task.requirements.length > 0 && <span className='ingot-spec-task-req' title='Requirements'>R{task.requirements.join(', ')}</span>}
            {leaf && !task.done && <button type='button' className='ingot-dot-iconbtn ingot-spec-task-run' title={SPECS_TEXT.runTask} aria-label={`${SPECS_TEXT.runTask}: ${task.id}`}
                onClick={() => this.runner.runTask(spec, task)}>
                <span className='codicon codicon-play' />
            </button>}
        </li>;
    }
}
