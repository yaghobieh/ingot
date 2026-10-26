import * as React from '@theia/core/shared/react';
import type { ProcessInfo, ProcessOutput } from '../../common/processes/processes.types';
import { formatUptime, isListed, STATUS_LABELS, uptimeOf } from '../../common/processes/processes.utils';
import { PROCESS_OUTPUT_POLL_MS, PROCESS_UPTIME_TICK_MS } from './processes.browser-consts';

export interface ProcessesPanelProps {
    readonly processes: readonly ProcessInfo[];
    /** Shown even with no processes (the header button). */
    readonly pinned: boolean;
    readonly onStop: (id: string) => void;
    readonly onRun: () => void;
    readonly onClear: () => void;
    readonly onOpenPort: (port: number) => void;
    readonly readOutput: (id: string) => Promise<ProcessOutput | undefined>;
}

/**
 * IDEA-132: compact list of agent / user processes above the composer: command, status, uptime and port, live.
 * Click a row for its output; ■ stops it.
 */
export const ProcessesPanel = (props: ProcessesPanelProps): React.ReactElement | null => {
    // Finished foreground commands (a build, a test run) live in the chat transcript; the list keeps background ones.
    const processes = props.processes.filter(isListed);
    const [collapsed, setCollapsed] = React.useState(false);
    const [open, setOpen] = React.useState<string | undefined>();
    const [now, setNow] = React.useState(Date.now());
    const running = processes.filter(p => p.status === 'running');

    React.useEffect(() => {
        if (!running.length) {
            setNow(Date.now());
            return undefined;
        }
        const timer = setInterval(() => setNow(Date.now()), PROCESS_UPTIME_TICK_MS);
        return () => clearInterval(timer);
    }, [running.length]);

    if (!processes.length && !props.pinned) {
        return null;
    }
    const finished = processes.length - running.length;
    return <div className={`ingot-processes${collapsed ? ' collapsed' : ''}`} id='ingot-processes'>
        <div className='ingot-processes-head'>
            <button type='button' className='ingot-processes-toggle' id='ingot-processes-toggle' aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
                <span className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
                <span className='ingot-processes-title'>Processes</span>
                <span className='ingot-processes-count' id='ingot-processes-count'>
                    {running.length ? `${running.length} running` : processes.length ? 'none running' : 'none'}
                </span>
            </button>
            <span className='ingot-flex' />
            {finished > 0 && <button type='button' className='ingot-icon-button codicon codicon-clear-all' id='ingot-processes-clear' title='Clear finished' aria-label='Clear finished' onClick={props.onClear} />}
            <button type='button' className='ingot-icon-button codicon codicon-add' id='ingot-processes-run' title='Run a script or command' aria-label='Run a script or command' onClick={props.onRun} />
        </div>
        {!collapsed && <div className='ingot-processes-list' role='list'>
            {!processes.length && <div className='ingot-processes-empty ingot-dim'>Nothing running. Processes the agent or you start show up here.</div>}
            {processes.map(p => <ProcessRow key={p.id} process={p} now={now} open={open === p.id} props={props}
                onToggle={() => setOpen(open === p.id ? undefined : p.id)} />)}
        </div>}
    </div>;
};

const ProcessRow = ({ process: p, now, open, onToggle, props }: { process: ProcessInfo; now: number; open: boolean; onToggle: () => void; props: ProcessesPanelProps }): React.ReactElement =>
    <div className={`ingot-process ingot-process-${p.status}${open ? ' open' : ''}`} role='listitem' data-id={p.id} data-status={p.status}>
        <div className='ingot-process-row' role='button' tabIndex={0} title={`${p.command}\n${p.cwd}`} aria-expanded={open}
            onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
            <span className='ingot-process-dot' aria-hidden='true' />
            <span className={`ingot-process-origin codicon codicon-${p.origin === 'agent' ? 'sparkle' : 'person'}`} title={p.origin === 'agent' ? 'Started by the agent' : 'Started by you'} />
            <code className='ingot-process-command'>{p.command}</code>
            {p.ports.map(port => <button type='button' key={port} className='ingot-process-port' title={`Open http://localhost:${port}`}
                onClick={e => { e.stopPropagation(); props.onOpenPort(port); }}>:{port}</button>)}
            <span className='ingot-process-status'>{p.status === 'running' ? '' : `${STATUS_LABELS[p.status]}${p.status === 'failed' && p.exitCode !== undefined ? ` (${p.exitCode})` : ''}`}</span>
            <span className='ingot-process-uptime'>{formatUptime(uptimeOf(p, now))}</span>
            {p.status === 'running'
                ? <button type='button' className='ingot-icon-button codicon codicon-debug-stop ingot-process-stop' title='Stop' aria-label={`Stop ${p.command}`}
                    onClick={e => { e.stopPropagation(); props.onStop(p.id); }} />
                : <span className='ingot-process-stop-spacer' />}
        </div>
        {open && <ProcessOutputView id={p.id} running={p.status === 'running'} read={props.readOutput} />}
    </div>;

const ProcessOutputView = ({ id, running, read }: { id: string; running: boolean; read: ProcessesPanelProps['readOutput'] }): React.ReactElement => {
    const [text, setText] = React.useState<string | undefined>();
    const ref = React.useRef<HTMLPreElement>(null);
    React.useEffect(() => {
        let alive = true;
        const load = async (): Promise<void> => {
            const out = await read(id).catch(() => undefined);
            if (alive) {
                setText(out ? `${out.truncated ? '… (earlier output cut)\n' : ''}${out.text}` : '');
            }
        };
        void load();
        const timer = running ? setInterval(() => void load(), PROCESS_OUTPUT_POLL_MS) : undefined;
        return () => { alive = false; if (timer) { clearInterval(timer); } };
    }, [id, running]);
    React.useEffect(() => {
        const el = ref.current;
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
            el.scrollTop = el.scrollHeight;
        }
    }, [text]);
    return <pre className='ingot-process-output' ref={ref} tabIndex={0}>{text === undefined ? '…' : text.trimEnd() || 'No output yet.'}</pre>;
};
