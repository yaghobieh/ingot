import { TRACE_LINE_CHARS } from './agent-quality.consts';

/** The shape `window.ingotAgentTrace()` returns (see @ingot/core agent-trace.types). */
export interface TraceSnapshot {
    readonly status: string;
    readonly running: boolean;
    readonly plan: readonly { readonly text: string; readonly state: string }[];
    readonly steps: readonly { readonly kind: string; readonly target: string; readonly done: boolean; readonly added?: number; readonly removed?: number }[];
    readonly messages: readonly {
        readonly role: string; readonly text: string; readonly from?: string; readonly hidden?: boolean;
        readonly tool?: string; readonly toolState?: string; readonly toolArgs?: string;
    }[];
    readonly ask?: string;
    readonly approval?: string;
}

const PLAN_MARK: Record<string, string> = { done: '[x]', active: '[>]', todo: '[ ]' };
const STEP_MARK: Record<string, string> = { edit: '✎', read: '·', run: '▸', search: '⌕' };
const FINISHED = new Set(['done', 'error']);

const clip = (text: string, max = TRACE_LINE_CHARS): string => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const lastLine = (text: string): string => text.trim().split('\n').filter(Boolean).pop() ?? '';

const toolLabel = (args: string | undefined): string => {
    try {
        const parsed = JSON.parse(args ?? '{}') as Record<string, unknown>;
        const main = parsed.command ?? parsed.path ?? parsed.pattern ?? parsed.op ?? parsed.question ?? '';
        const cwd = typeof parsed.cwd === 'string' && parsed.cwd ? ` (cwd ${parsed.cwd})` : '';
        return `${String(main)}${cwd}`;
    } catch {
        return '';
    }
};

/**
 * Turns successive snapshots into printable lines: plan changes, new steps, tool results, nudges and the
 * reply text as it streams. Reply text is printed line by line; a partial line waits for its newline.
 */
export class TracePrinter {
    protected plan = '';
    protected steps = 0;
    protected status = '';
    protected printed = new Map<number, number>();
    protected tools = new Map<number, string>();

    next(trace: TraceSnapshot): string[] {
        const out: string[] = [];
        if (trace.status !== this.status) {
            out.push(`── status: ${this.status || 'start'} → ${trace.status}${trace.running ? ' (running)' : ''}`);
            this.status = trace.status;
        }
        const plan = trace.plan.map(item => `${PLAN_MARK[item.state] ?? '[ ]'} ${item.text}`).join('\n');
        if (plan && plan !== this.plan) {
            out.push('── plan:', ...plan.split('\n').map(line => `   ${clip(line)}`));
            this.plan = plan;
        }
        for (const step of trace.steps.slice(this.steps)) {
            const stats = step.kind === 'edit' && step.added !== undefined ? ` (+${step.added} −${step.removed ?? 0})` : '';
            out.push(`   ${STEP_MARK[step.kind] ?? '•'} ${step.kind} ${clip(step.target)}${stats}`);
        }
        this.steps = trace.steps.length;
        trace.messages.forEach((message, index) => out.push(...this.message(message, index, index === trace.messages.length - 1 && trace.running)));
        if (trace.approval) {
            out.push(`── approval: ${clip(trace.approval)}`);
        }
        if (trace.ask) {
            out.push(`── question: ${clip(trace.ask)}`);
        }
        return out;
    }

    protected message(message: TraceSnapshot['messages'][number], index: number, live: boolean): string[] {
        if (message.role === 'tool') {
            const state = message.toolState ?? 'done';
            if (this.tools.get(index) === state || (!FINISHED.has(state) && message.tool)) {
                return [];
            }
            this.tools.set(index, state);
            const label = message.tool ? `${message.tool} ${toolLabel(message.toolArgs)}` : message.from ?? 'tool';
            return [`   ⚙ ${clip(label, TRACE_LINE_CHARS / 2)} → ${state}: ${clip(lastLine(message.text))}`];
        }
        const seen = this.printed.get(index) ?? 0;
        if (message.role === 'agent') {
            const ready = live ? message.text.slice(0, message.text.lastIndexOf('\n') + 1) : message.text;
            if (ready.length <= seen) {
                return [];
            }
            this.printed.set(index, ready.length);
            return ready.slice(seen).split('\n').filter(line => line.trim()).map(line => `   │ ${clip(line)}`);
        }
        if (seen) {
            return [];
        }
        this.printed.set(index, message.text.length || 1);
        if (message.role === 'user') {
            return [message.hidden ? `── nudge: ${clip(message.text)}` : `── user: ${clip(message.text)}`];
        }
        return [`── ${message.role}: ${clip(message.text)}`];
    }
}
