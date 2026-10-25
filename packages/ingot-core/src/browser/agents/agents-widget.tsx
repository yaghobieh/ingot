import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { AGENT_MODES, COMPOSER_PLACEHOLDER, MODEL_OPTIONS, NO_MODEL_MESSAGE } from '../../common/agents/agents.consts';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { IngotModelClient } from '../models/model-client';
import { MODELS_OPEN_COMMAND } from '../models/models.browser-consts';
import type { AgentMode, AgentSession } from '../../common/agents/agents.types';
import { agentSubtitle, changesSummary, stepVerb } from '../../common/agents/agents.utils';
import { AgentStore } from './agent-store';
import { AgentEditReview } from './agent-edit-review';
import { AGENTS_WIDGET_ID, AGENTS_WIDGET_LABEL } from './agents.consts';

type AgentsTab = 'agents' | 'history';

/** Right tool window: agent list, conversation with plan and tool steps, composer (IDEA-27/28, design reference). */
@injectable()
export class IngotAgentsWidget extends ReactWidget {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(AgentEditReview) protected readonly review: AgentEditReview;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected tab: AgentsTab = 'agents';
    protected draft = '';
    protected composer?: HTMLTextAreaElement | null;

    @postConstruct()
    protected init(): void {
        this.id = AGENTS_WIDGET_ID;
        this.title.label = AGENTS_WIDGET_LABEL;
        this.title.caption = AGENTS_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-ai';
        this.addClass('ingot-agents');
        this.toDispose.push(this.store.onDidChange(() => this.update()));
        this.toDispose.push(this.review.onDidChange(() => this.update()));
        this.toDispose.push(this.models.onDidChange(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.composer ?? this.node).focus();
    }

    protected submit(): void {
        if (!this.draft.trim()) {
            return;
        }
        this.store.send(this.draft);
        this.draft = '';
        this.update();
    }

    protected render(): React.ReactNode {
        const now = Date.now();
        const current = this.store.current;
        const sessions = this.tab === 'agents' ? this.store.sessions.filter(s => s.status !== 'done') : this.store.sessions.filter(s => s.status === 'done');
        return <div className='ingot-agents-root'>
            <div className='ingot-agents-header'>
                {(['agents', 'history'] as const).map(t => (
                    <button key={t} type='button' id={`ingot-agents-tab-${t}`} className={`ingot-agents-tab ${this.tab === t ? 'active' : ''}`} onClick={() => { this.tab = t; this.update(); }}>
                        {t === 'agents' ? 'Agents' : 'History'}
                    </button>
                ))}
                <span className='ingot-flex' />
                <button type='button' id='ingot-agents-new' className='ingot-agents-new' onClick={() => { this.store.create(); this.composer?.focus(); }}>+ New agent</button>
            </div>
            <div className='ingot-agents-list'>
                {sessions.length === 0 && <div className='ingot-agents-empty'>{this.tab === 'agents' ? 'No running agents. Start one below.' : 'Finished agents appear here.'}</div>}
                {sessions.map(s => (
                    <button key={s.id} type='button' className={`ingot-agent-item ${current?.id === s.id ? 'selected' : ''}`} onClick={() => this.store.select(s.id)}>
                        <span className={`ingot-agent-status ingot-status-${s.status}`} />
                        <span className='ingot-agent-item-text'>
                            <span className='ingot-agent-item-title'>{s.title}</span>
                            <span className='ingot-agent-item-sub'>{agentSubtitle(s, now)}</span>
                        </span>
                    </button>
                ))}
            </div>
            <div className='ingot-agents-chat'>{current ? this.renderSession(current) : <div className='ingot-agents-hint'>Describe a task and an agent will plan, edit and ask you to review.</div>}</div>
            {this.renderComposer()}
        </div>;
    }

    protected renderSession(session: AgentSession): React.ReactNode {
        const pending = this.review.pending;
        return <>
            {session.messages.map((m, i) => (
                <div key={i} className={`ingot-chat-msg ingot-chat-${m.role}`}>
                    {m.from && <div className='ingot-chat-from'>{m.from}</div>}
                    {m.text || (m.role === 'agent' && this.store.isRunning(session.id) ? <span className='ingot-chat-typing'>…</span> : '')}
                    {m.role === 'agent' && i === session.messages.length - 1 && session.status === 'editing' && session.activeFile && <div className='ingot-chat-editing'>Editing {session.activeFile}…</div>}
                    {m.text === NO_MODEL_MESSAGE && <div><button type='button' id='ingot-open-models' className='ingot-btn-primary ingot-chat-action' onClick={() => this.commands.executeCommand(MODELS_OPEN_COMMAND.id)}>Open Models</button></div>}
                </div>
            ))}
            {session.plan.length > 0 && <div className='ingot-chat-plan'>
                <div className='ingot-chat-label'>Plan</div>
                {session.plan.map((p, i) => (
                    <div key={i} className={`ingot-plan-item ingot-plan-${p.state}`}><span className='ingot-plan-mark'>{p.state === 'done' ? '✓' : p.state === 'active' ? '●' : '○'}</span>{p.text}</div>
                ))}
            </div>}
            {session.steps.map((step, i) => (
                <div key={i} className={`ingot-chat-step ${step.done ? 'done' : 'running'}`}>
                    <span className='ingot-step-mark'>{step.done ? '✓' : '●'}</span>
                    <span className='ingot-step-text'>{stepVerb(step)} {step.target}</span>
                    {step.added !== undefined && <span className='ingot-step-diff'><span className='ingot-plus'>+{step.added}</span> <span className='ingot-minus'>−{step.removed ?? 0}</span></span>}
                </div>
            ))}
            {session.changes.length > 0 && <div className='ingot-chat-changes'>
                <span>{changesSummary(session.changes.length)}</span>
                <span className='ingot-flex' />
                <button type='button' id='ingot-agents-undo' className='ingot-btn-ghost' disabled={!pending} onClick={() => this.review.reject()}>Undo</button>
                <button type='button' id='ingot-agents-keep' className='ingot-btn-primary' disabled={!pending} onClick={() => this.review.accept()}>Keep all</button>
            </div>}
        </>;
    }

    protected renderComposer(): React.ReactNode {
        return <div className='ingot-composer'>
            <textarea id='ingot-composer-input' ref={el => { this.composer = el; }} className='ingot-composer-input' placeholder={COMPOSER_PLACEHOLDER} value={this.draft} rows={2}
                onChange={e => { this.draft = e.currentTarget.value; this.update(); }}
                onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
                    if (e.key === 'Escape' && this.store.current && this.store.isRunning(this.store.current.id)) { e.preventDefault(); this.store.stop(this.store.current.id); }
                }} />
            <div className='ingot-composer-bar'>
                <select id='ingot-composer-mode' className='ingot-select' value={this.store.mode} aria-label='Agent mode' onChange={e => { this.store.mode = e.currentTarget.value as AgentMode; this.store.changed(); }}>
                    {AGENT_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <select id='ingot-composer-model' className='ingot-select' value={this.store.model} aria-label='Model' onChange={e => { this.store.model = e.currentTarget.value; this.store.changed(); }}>
                    {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}{this.models.isModelConfigured(m.id) ? '' : ' — not connected'}</option>)}
                </select>
                <span className='ingot-flex' />
                {this.store.isRunning(this.store.current?.id)
                    ? <button type='button' id='ingot-composer-stop' className='ingot-composer-send ingot-composer-stop' aria-label='Stop' title='Stop (Esc)' onClick={() => this.store.stop(this.store.current!.id)}>■</button>
                    : <button type='button' id='ingot-composer-send' className='ingot-composer-send' aria-label='Send' disabled={!this.draft.trim()} onClick={() => this.submit()}>↑</button>}
            </div>
        </div>;
    }
}
