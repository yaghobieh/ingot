/** IDEA-187: the composer's `/` built-in commands and `@` file mentions. */
import type { AgentMode } from './agents.types';

export type SlashBuiltinAction = { kind: 'mode'; mode: AgentMode } | { kind: 'new' } | { kind: 'compact' } | { kind: 'model' } | { kind: 'history' } | { kind: 'memories' } | { kind: 'browser' };

export interface SlashBuiltin {
    readonly name: string;
    readonly description: string;
    readonly action: SlashBuiltinAction;
}

export const SLASH_BUILTINS: readonly SlashBuiltin[] = [
    { name: 'agent', description: 'Agent mode: plan, edit files and run tools', action: { kind: 'mode', mode: 'agent' } },
    { name: 'ask', description: 'Ask mode: answers only, no file changes', action: { kind: 'mode', mode: 'ask' } },
    { name: 'plan', description: 'Plan mode: a step-by-step plan to build later', action: { kind: 'mode', mode: 'plan' } },
    { name: 'debug', description: 'Debug mode: find the cause, then fix', action: { kind: 'mode', mode: 'debug' } },
    { name: 'multi', description: 'Multi-agent: split the task across parallel agents', action: { kind: 'mode', mode: 'multi' } },
    { name: 'new', description: 'Start a new chat', action: { kind: 'new' } },
    { name: 'compact', description: 'Summarize this chat to free up context', action: { kind: 'compact' } },
    { name: 'model', description: 'Pick the model', action: { kind: 'model' } },
    { name: 'history', description: 'Open chat history', action: { kind: 'history' } },
    { name: 'memories', description: 'Manage memories', action: { kind: 'memories' } },
    { name: 'browser', description: 'Let the agent use the Browser panel for this run: navigate, click, type, screenshots, console and failed requests', action: { kind: 'browser' } }
];

/** The `@query` right before the caret, if one is being typed (start of text or after a space). */
export const mentionQuery = (before: string): string | undefined => /(?:^|\s)@([\w./-]*)$/.exec(before)?.[1];

/** Ranks project files for a mention query: exact base name, base prefix, path substring, then subsequence. */
export const rankFiles = (files: readonly string[], query: string, limit = 8): string[] => {
    const q = query.toLowerCase();
    const score = (path: string): number => {
        const p = path.toLowerCase();
        const base = p.split('/').pop() ?? p;
        // IDEA-251: on a tie, shallower files first (the root package.json before the nested ones).
        const depth = p.split('/').length / 10_000;
        if (!q) {
            return 1 + 1 / (1 + p.split('/').length);
        }
        if (base === q) {
            return 100 - depth;
        }
        if (base.startsWith(q)) {
            return 80 - base.length / 100 - depth;
        }
        if (base.includes(q)) {
            return 60 - base.length / 100 - depth;
        }
        if (p.includes(q)) {
            return 40 - p.length / 1000;
        }
        let i = 0;
        for (const ch of p) {
            if (ch === q[i]) {
                i++;
            }
        }
        return i === q.length ? 10 - p.length / 1000 : 0;
    };
    return files.map(f => ({ f, s: score(f) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.f.localeCompare(b.f)).slice(0, limit).map(x => x.f);
};
