import * as React from '@theia/core/shared/react';
import type { AgentSession } from '../../common/agents/agents.types';
import { subagentInfo, subagentsSummary, type SubagentInfo, type SubagentsView } from '../../common/agents/subagents';
import { RexMark } from '../brand/rex-mark';
import { SUBAGENT_MARK_SIZE } from './agents.consts';

/**
 * IDEA-181: a chat's subagents (Multi-agent subtasks and Zaprex Harmony pieces) in a compact strip above the
 * composer, never inline in the chat. Each row shows who runs it, its status and progress; clicking opens details.
 */
export interface SubagentsStripProps {
    readonly subagents: readonly AgentSession[];
    readonly isRunning: (id: string) => boolean;
    readonly view: SubagentsView;
    readonly selected?: string;
    readonly expanded: boolean;
    readonly onSelect: (id: string | undefined) => void;
    readonly onToggle: () => void;
    readonly onOpenTab: (id: string) => void;
    readonly onStop: (id: string) => void;
    readonly renderMarkdown: (text: string) => string;
}

const STATE_LABEL: Record<SubagentInfo['state'], string> = { running: 'Running', review: 'Review', done: 'Done', error: 'Needs attention', stopped: 'Stopped' };

const Who = ({ who }: { who: SubagentInfo['who'] }): React.ReactElement => who === 'zaprex'
    ? <span className='ingot-sa-who ingot-sa-zaprex ingot-zaprex-link-icon' title='Zaprex' aria-label='Zaprex' />
    : <span className='ingot-sa-who ingot-sa-ingot' title='Ingot agent'><RexMark size={SUBAGENT_MARK_SIZE} label='Ingot agent' /></span>;

const Progress = ({ info }: { info: SubagentInfo }): React.ReactElement =>
    <span className={`ingot-sa-progress ${info.state}${info.progress === undefined ? ' indeterminate' : ''}`} role='progressbar'
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={info.progress === undefined ? undefined : Math.round(info.progress * 100)}>
        <span className='ingot-sa-progress-fill' style={info.progress === undefined ? undefined : { width: `${Math.round(info.progress * 100)}%` }} />
    </span>;

const Details = ({ session, info, props }: { session: AgentSession; info: SubagentInfo; props: SubagentsStripProps }): React.ReactElement => {
    const reply = [...session.messages].reverse().find(m => m.role === 'agent' && m.text);
    const edits = session.steps.filter(s => s.kind === 'edit');
    const notes = session.messages.filter(m => m.role === 'system').slice(-3);
    return <div className='ingot-sa-details' id='ingot-sa-details' role='region' aria-label={`${info.title} details`}>
        <div className='ingot-sa-details-head'>
            <Who who={info.who} />
            <b className='ingot-sa-details-title'>{info.title}</b>
            <span className={`ingot-sa-state ${info.state}`}>{STATE_LABEL[info.state]}</span>
            <span className='ingot-flex' />
            {info.state === 'running' && <button type='button' className='ingot-sa-btn' id='ingot-sa-stop' title='Stop this subagent' onClick={() => props.onStop(info.id)}><span className='codicon codicon-debug-stop' /></button>}
            <button type='button' className='ingot-sa-btn' id='ingot-sa-open-tab' title='Open as a chat tab' onClick={() => props.onOpenTab(info.id)}><span className='codicon codicon-link-external' /></button>
            <button type='button' className='ingot-sa-btn' id='ingot-sa-close' title='Close details' onClick={() => props.onSelect(undefined)}><span className='codicon codicon-close' /></button>
        </div>
        <div className='ingot-sa-task'>{info.task}</div>
        {session.scope?.length ? <div className='ingot-sa-scope'><span className='codicon codicon-lock' /> {session.scope.join(', ')}</div> : undefined}
        {session.plan.length > 0 && <ul className='ingot-sa-plan'>{session.plan.map((p, i) => <li key={i} className={p.state}>{p.state === 'done' ? '✓' : p.state === 'active' ? '●' : '○'} {p.text}</li>)}</ul>}
        {edits.length > 0 && <ul className='ingot-sa-edits'>{edits.map((s, i) => <li key={i}><span className='codicon codicon-diff' />{s.target}{s.added !== undefined && <span className='ingot-sa-diff'><span className='ingot-plus'>+{s.added}</span> <span className='ingot-minus'>−{s.removed ?? 0}</span></span>}</li>)}</ul>}
        {notes.map((m, i) => <div key={i} className='ingot-sa-note'>{m.text}</div>)}
        {reply && <div className='ingot-sa-reply ingot-md' dangerouslySetInnerHTML={{ __html: props.renderMarkdown(reply.text) }} />}
    </div>;
};

export const SubagentsStrip = (props: SubagentsStripProps): React.ReactElement | null => {
    if (!props.subagents.length) {
        return null;
    }
    const infos = props.subagents.map(s => subagentInfo(s, props.isRunning(s.id)));
    const selected = props.subagents.find(s => s.id === props.selected);
    const open = props.expanded;
    const running = infos.filter(i => i.state === 'running').length;
    return <div className={`ingot-subagents ${props.view}${open ? ' open' : ''}`} id='ingot-subagents'>
        {selected && <Details session={selected} info={infos.find(i => i.id === selected.id)!} props={props} />}
        <button type='button' className='ingot-sa-header' id='ingot-subagents-toggle' aria-expanded={open} onClick={props.onToggle}>
            {running ? <span className='ingot-sa-spinner' aria-hidden='true' /> : <span className='codicon codicon-type-hierarchy-sub' />}
            <span className='ingot-sa-header-label'>Subagents</span>
            <span className='ingot-sa-count'>{infos.length}</span>
            <span className='ingot-sa-summary' id='ingot-subagents-summary'>{subagentsSummary(infos)}</span>
            <span className='ingot-flex' />
            <span className={`codicon codicon-chevron-${open ? 'down' : 'up'}`} />
        </button>
        {open && <div className='ingot-sa-list' role='list'>{infos.map(info =>
            <button type='button' key={info.id} role='listitem' className={`ingot-sa-row ${info.state}${info.id === props.selected ? ' selected' : ''}`}
                data-subagent={info.id} title={info.task} onClick={() => props.onSelect(info.id === props.selected ? undefined : info.id)}>
                <Who who={info.who} />
                <span className='ingot-sa-title'>{info.title}</span>
                <span className='ingot-sa-detail'>{info.detail}</span>
                <Progress info={info} />
                <span className={`ingot-sa-dot ${info.state}`} title={STATE_LABEL[info.state]} />
            </button>)}</div>}
    </div>;
};
