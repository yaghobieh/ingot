import { EDITING_LABEL } from './agents.consts';
import type { AgentMessage } from './agents.types';
import { fileWord } from './agents.utils';
import {
    BROWSER_TOOL_PREFIX, COMMAND_KINDS, COMMAND_MAX_CHARS, COMMAND_MAX_WORDS, COMMAND_STOP_RE, DELETE_TOOL, DELETING_WORD, EDIT_TOOLS, ELLIPSIS,
    FLOW_KINDS, GIT_OPS, GIT_TOOL, LIST_TOOL, LIVE_LOG_MAX, LIVE_STATUS_TEXT, READ_TOOL, READING_WORD, RUN_TOOLS, RUNNING_WORD, SCRIPT_RUNNER,
    SEARCH_TOOLS, SOME_FILE, SUBAGENT_TOOL, WEB_TOOLS
} from './live-status.consts';
import type { CommandKind, LiveStatus, LiveStatusInput, LiveStatusKind, LiveStep } from './live-status.types';
import { extractThought, type ToolCallInfo } from './tool-cards';

const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** `src/App.tsx` → `App.tsx`. */
export const fileName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path;

const fixed = (kind: keyof typeof LIVE_STATUS_TEXT & LiveStatusKind): LiveStatus => ({ kind, label: LIVE_STATUS_TEXT[kind] });

export const editingStatus = (path: string): LiveStatus => ({ kind: 'editing', label: `${EDITING_LABEL} ${fileName(path)}${ELLIPSIS}` });

/** Tests, checks, builds, installs and dev servers read as a sentence; anything else names the command. */
export const commandKind = (command: string): CommandKind | undefined => COMMAND_KINDS.find(k => k.pattern.test(command))?.kind;

/** `npm run hello -- --watch` → `npm run hello`; `node -e "…"` → `node`. */
export const shortCommand = (command: string): string => {
    const words: string[] = [];
    for (const word of command.trim().split(/\s+/)) {
        if (!word || COMMAND_STOP_RE.test(word) || words.length === COMMAND_MAX_WORDS) {
            break;
        }
        words.push(word);
    }
    const text = words.join(' ');
    return text.length > COMMAND_MAX_CHARS ? text.slice(0, COMMAND_MAX_CHARS).trimEnd() : text;
};

export const commandStatus = (command: string): LiveStatus => {
    const kind = commandKind(command);
    if (kind) {
        return fixed(kind);
    }
    const short = shortCommand(command);
    return short ? { kind: 'running', label: `${RUNNING_WORD} ${short}${ELLIPSIS}` } : fixed('working');
};

/** Tool calls of the current round: the `tool` messages after the latest agent reply. */
const roundTools = (messages: readonly AgentMessage[]): ToolCallInfo[] => {
    const tools: ToolCallInfo[] = [];
    for (let i = messages.length - 1; i >= 0 && messages[i].role !== 'agent'; i--) {
        const tool = messages[i].tool;
        if (messages[i].role === 'tool' && tool) {
            tools.unshift(tool);
        }
    }
    return tools;
};

/** The line for a tool call that is running; reads count the files this round asked for (or has read so far). */
export const toolStatus = (tool: ToolCallInfo, round: readonly ToolCallInfo[], planned: readonly string[] = []): LiveStatus => {
    const name = tool.tool;
    if (name === READ_TOOL) {
        const reads = Math.max(round.filter(t => t.tool === READ_TOOL).length, planned.filter(t => t === READ_TOOL).length);
        const what = reads > 1 ? `${reads} ${fileWord(reads)}` : fileName(str(tool.args.path)) || SOME_FILE;
        return { kind: 'reading', label: `${READING_WORD} ${what}${ELLIPSIS}` };
    }
    if (name === LIST_TOOL) {
        return fixed('exploring');
    }
    if (SEARCH_TOOLS.includes(name)) {
        return fixed('searching');
    }
    if (WEB_TOOLS.includes(name)) {
        return fixed('web');
    }
    if (name === RUN_TOOLS.tests) {
        return fixed('testing');
    }
    if (name === RUN_TOOLS.diagnostics) {
        return fixed('checks');
    }
    if (name === RUN_TOOLS.run) {
        return commandStatus(str(tool.args.command));
    }
    if (name === RUN_TOOLS.script) {
        const script = str(tool.args.script);
        return script ? commandStatus(`${SCRIPT_RUNNER} ${script}`) : fixed('working');
    }
    if (EDIT_TOOLS.includes(name) && str(tool.args.path)) {
        return editingStatus(str(tool.args.path));
    }
    if (name === DELETE_TOOL && str(tool.args.path)) {
        return { kind: 'deleting', label: `${DELETING_WORD} ${fileName(str(tool.args.path))}${ELLIPSIS}` };
    }
    if (name === GIT_TOOL) {
        const op = str(tool.args.op);
        return { kind: 'git', label: op === GIT_OPS.commit ? LIVE_STATUS_TEXT.commit : op === GIT_OPS.push ? LIVE_STATUS_TEXT.push : LIVE_STATUS_TEXT.git };
    }
    if (name.startsWith(BROWSER_TOOL_PREFIX)) {
        return fixed('browser');
    }
    if (name === SUBAGENT_TOOL) {
        return fixed('subagents');
    }
    return fixed('working');
};

/**
 * The live status line at the end of a running chat, from what the run is doing right now: a store phase
 * (plan check, wrap-up), then the tool call that is running, then the streaming reply ("Thinking…" before the
 * first token, "Typing…" after it, "Editing App.tsx…" while a file streams). Nothing while the run waits on the
 * user, or while a thought streams (its own "Thinking…" row shimmers instead).
 */
export const liveStatus = ({ session, running, streaming, phase, planned }: LiveStatusInput): LiveStatus | undefined => {
    if (session.ask || session.status === 'approval' || (!running && !phase)) {
        return undefined;
    }
    if (phase) {
        return fixed(phase);
    }
    const round = roundTools(session.messages);
    const active = [...round].reverse().find(t => t.state === 'running');
    if (active) {
        return toolStatus(active, round, planned);
    }
    if (session.status === 'editing' && session.activeFile) {
        return editingStatus(session.activeFile);
    }
    const last = session.messages[session.messages.length - 1];
    if (streaming && last?.role === 'agent') {
        if (!last.parts && extractThought(last.text).thinking) {
            return undefined;
        }
        return fixed(last.text.trim() ? 'typing' : 'waiting');
    }
    return fixed('working');
};

/** How long the shown line must still stay up before the next one may replace it. */
export const holdRemaining = (shownAt: number, now: number, minMs: number): number => Math.max(0, shownAt + minMs - now);

export const liveKey = (status: LiveStatus | undefined): string => status ? `${status.kind}:${status.label}` : '';

/** Adds the line the run shows now, unless it is already the latest one. */
export const appendStep = (log: readonly LiveStep[], status: LiveStatus | undefined): readonly LiveStep[] => {
    const last = log[log.length - 1];
    if (last ? liveKey(last.status) === liveKey(status) : !status) {
        return log;
    }
    return [...log, { seq: (last?.seq ?? 0) + 1, ...(status ? { status } : {}) }].slice(-LIVE_LOG_MAX);
};

const isStep = (step: LiveStep): boolean => !!step.status && !FLOW_KINDS.includes(step.status.kind);

/**
 * What the line shows after `shownSeq`: the oldest step not shown yet (a grep that took 5 ms still reads
 * "Searching the codebase…"), else the latest line. Undefined when nothing is newer.
 */
export const nextStep = (log: readonly LiveStep[], shownSeq: number): LiveStep | undefined => {
    const newer = log.filter(step => step.seq > shownSeq);
    const latest = newer[newer.length - 1];
    return newer.find(step => step !== latest && isStep(step)) ?? latest;
};
