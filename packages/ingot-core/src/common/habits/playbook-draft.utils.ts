import { BUILTIN_TOOL_SERVER } from '../agents/agent-actions';
import type { AgentMessage, AgentStep } from '../agents/agents.types';
import type { Habit } from './habits.types';
import {
    CHECK_COMMAND, DRAFT_DEFAULT_CRITERION, DRAFT_FALLBACK_STEPS, DRAFT_SKIPPED_TOOLS, ERROR_TOKEN, MAX_DRAFT_GLOBS, MAX_DRAFT_KEYWORDS, MAX_DRAFT_STEPS, MAX_NAME_WORDS,
    MAX_READS_PER_STEP, MAX_WHEN_CHARS, MIN_KEYWORD_CHARS, STOPWORDS
} from './playbook.consts';
import type { PlaybookDraft, RunAction, RunSummary } from './playbook.types';

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const code = (v: string): string => `\`${v.replace(/`/g, '')}\``;
const clip = (text: string, max: number): string => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The last turn of a chat: the prompt as typed, its tool calls (in order) and the files the agent edited. */
export const runSummary = (messages: readonly AgentMessage[], steps: readonly AgentStep[]): RunSummary | undefined => {
    const at = messages.map((m, i) => ({ m, i })).reverse().find(x => x.m.role === 'user' && !x.m.hidden)?.i;
    if (at === undefined) {
        return undefined;
    }
    const actions: RunAction[] = messages.slice(at + 1).flatMap(m => m.role === 'tool' && m.tool && m.tool.state !== 'running'
        ? [{ server: m.tool.server, tool: m.tool.tool, args: m.tool.args, ok: m.tool.state === 'done' }] : []);
    const edits = [...new Set(steps.filter(s => s.kind === 'edit').map(s => s.target.replace(/^\.\/+/, '')))];
    return { prompt: messages[at].text.trim(), actions, edits };
};

/** One habit step for a tool call; undefined for calls that are not part of the scenario (asking, hooks…). */
export const actionStep = (a: RunAction): string | undefined => {
    if (DRAFT_SKIPPED_TOOLS.includes(a.tool)) {
        return undefined;
    }
    if (a.server !== BUILTIN_TOOL_SERVER) {
        return `Call ${code(`${a.server}/${a.tool}`)}`;
    }
    const path = str(a.args.path);
    switch (a.tool) {
        case 'grep': return `Search the code for ${code(str(a.args.pattern))}${path ? ` in ${code(path)}` : ''}`;
        case 'glob': return `Find files matching ${code(str(a.args.pattern))}`;
        case 'read_file': return `Read ${code(path)}`;
        case 'list_dir': return `Look through ${code(`${(path || '.').replace(/\/+$/, '')}/`)}`;
        case 'run': return `Run ${code(str(a.args.command))}`;
        case 'run_script': return `Run the ${code(str(a.args.script))} script`;
        case 'git': return `Git ${str(a.args.op) || 'action'}`;
        case 'web_search': return `Search the web for "${str(a.args.query)}"`;
        case 'web_fetch': return `Read ${str(a.args.url)}`;
        case 'fetch_rule': return `Read the ${code(str(a.args.name))} rule`;
        case 'browser_open': return `Open ${str(a.args.url)} in the browser`;
        default: return a.tool.startsWith('browser_') ? undefined : `Use ${code(`${BUILTIN_TOOL_SERVER}/${a.tool}`)}`;
    }
};

/** Steps of a run: tool calls in order, consecutive reads folded, the edit step before the final checks. */
const runSteps = (run: RunSummary): string[] => {
    const out: string[] = [];
    let reads: string[] = [];
    const flush = (): void => {
        for (let i = 0; i < reads.length; i += MAX_READS_PER_STEP) {
            out.push(`Read ${reads.slice(i, i + MAX_READS_PER_STEP).map(code).join(', ')}`);
        }
        reads = [];
    };
    for (const a of run.actions) {
        if (a.server === BUILTIN_TOOL_SERVER && a.tool === 'read_file' && str(a.args.path)) {
            if (!reads.includes(str(a.args.path))) {
                reads.push(str(a.args.path));
            }
            continue;
        }
        const step = actionStep(a);
        if (step) {
            flush();
            if (out[out.length - 1] !== step) {
                out.push(step);
            }
        }
    }
    flush();
    if (run.edits.length) {
        const edit = `Make the fix in ${run.edits.slice(0, MAX_READS_PER_STEP).map(code).join(', ')}${run.edits.length > MAX_READS_PER_STEP ? ' and related files' : ''}`;
        let at = out.length;
        while (at > 0 && /^Run /.test(out[at - 1]) && CHECK_COMMAND.test(out[at - 1])) {
            at--;
        }
        out.splice(at, 0, edit);
    }
    return [...new Set(out)].slice(0, MAX_DRAFT_STEPS);
};

const nameFrom = (prompt: string): string => {
    const clause = prompt.split(/[.:!?\n]/)[0] ?? prompt;
    const words = clause.replace(/[`"'@]/g, '').split(/\s+/).filter(Boolean).slice(0, MAX_NAME_WORDS).join(' ');
    return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Saved habit';
};

/** Distinctive words of a prompt, in order (no stopwords, no paths). */
export const promptKeywords = (prompt: string): string[] => {
    const words = prompt.toLowerCase().replace(/@\S+|`[^`]*`|https?:\/\/\S+/g, ' ').split(/[^a-z0-9-]+/)
        .map(w => w.replace(/^-+|-+$/g, '')).filter(w => w.length >= MIN_KEYWORD_CHARS && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    return [...new Set(words)].slice(0, MAX_DRAFT_KEYWORDS);
};

/** `PaymentError`, `ENOENT`… named in the prompt, as an alternation. */
export const errorRegexFrom = (text: string): string | undefined => {
    const tokens = [...new Set([...text.matchAll(ERROR_TOKEN)].map(m => m[1]))];
    return tokens.length ? tokens.map(escapeRegex).join('|') : undefined;
};

/** `src/payments/**` for the folders of the edited files (read files when nothing was edited). */
const globsFrom = (files: readonly string[]): string[] => {
    const dirs = files.map(f => f.replace(/\\/g, '/').split('/').slice(0, -1).join('/')).filter(Boolean);
    return [...new Set(dirs.map(d => `${d}/**`))].slice(0, MAX_DRAFT_GLOBS);
};

/** Done criteria from the checks that passed at the end of the run (`npm test` passes). */
const criteriaFrom = (actions: readonly RunAction[]): string[] => {
    const checks = actions.filter(a => a.server === BUILTIN_TOOL_SERVER && a.tool === 'run' && a.ok && CHECK_COMMAND.test(str(a.args.command))).map(a => str(a.args.command));
    const unique = [...new Set(checks)];
    return unique.length ? unique.map(c => `${code(c)} passes`) : [DRAFT_DEFAULT_CRITERION];
};

/** "Save this run as a habit": a draft from the prompt, the steps taken and the files and commands. */
export const draftFromRun = (run: RunSummary): PlaybookDraft => {
    const reads = run.actions.filter(a => a.server === BUILTIN_TOOL_SERVER && a.tool === 'read_file').map(a => str(a.args.path)).filter(Boolean);
    const tools = [...new Set(run.actions.filter(a => !DRAFT_SKIPPED_TOOLS.includes(a.tool) && actionStep(a)).map(a => a.server === BUILTIN_TOOL_SERVER ? a.tool : `${a.server}/${a.tool}`))];
    const errorRegex = errorRegexFrom(run.prompt);
    const files = run.edits.length ? run.edits : reads;
    const steps = runSteps(run);
    return {
        name: nameFrom(run.prompt),
        when: `Tasks like: ${clip(run.prompt, MAX_WHEN_CHARS)}`,
        keywords: promptKeywords(run.prompt),
        globs: globsFrom(files),
        ...(errorRegex ? { errorRegex } : {}),
        steps: steps.length ? steps : DRAFT_FALLBACK_STEPS,
        allowedTools: tools,
        doneCriteria: criteriaFrom(run.actions),
        notes: files.length ? `Saved from a chat run. Files involved: ${files.map(code).join(', ')}.` : 'Saved from a chat run.'
    };
};

/** "Make it a habit" on a learned-pattern card: a one-scenario playbook from what the user keeps repeating. */
export const draftFromLearned = (habit: Pick<Habit, 'kind' | 'label' | 'text' | 'examples'>): PlaybookDraft => {
    const base = { globs: [], allowedTools: [], notes: `Made from a learned pattern (${habit.kind}: ${habit.label}).` };
    if (habit.kind === 'command') {
        return {
            ...base, name: `Run ${habit.label}`.slice(0, MAX_WHEN_CHARS), when: 'After changing code in this project', keywords: [],
            steps: ['Make the change', `Run ${code(habit.label)} and fix what fails`], doneCriteria: [`${code(habit.label)} passes`]
        };
    }
    const label = `${habit.label.charAt(0).toUpperCase()}${habit.label.slice(1)}`;
    return habit.kind === 'rejection'
        ? { ...base, name: `Do not ${habit.label}`, when: 'Writing or changing code', keywords: [], steps: ['Make the change', habit.text], doneCriteria: [habit.text.replace(/\.$/, '')] }
        : { ...base, name: label, when: `Tasks where you would ask to ${habit.label.toLowerCase()}`, keywords: promptKeywords(habit.label), steps: [habit.text], doneCriteria: [] };
};
