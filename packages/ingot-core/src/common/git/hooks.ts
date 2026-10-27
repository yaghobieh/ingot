/**
 * IDEA-178 agent-run git hooks. `.ingot/hooks.json` lists steps for `pre-commit` and `pre-push`; each step is a
 * shell command (`run`) or an agent check (`agent`, a prompt the model answers with PASS or FAIL about the diff).
 * Ingot runs them before it commits or pushes and shows each step as a tool card; a failure blocks the commit or
 * push and offers "Fix with agent" or "Bypass". Ingot also installs small git hooks so commits from a terminal run
 * the shell steps too.
 */
export const HOOKS_FILE = '.ingot/hooks.json';
export const HOOK_STAGES = ['pre-commit', 'pre-push'] as const;
export type HookStage = typeof HOOK_STAGES[number];

export const HOOKS_PREFS = { enabled: 'ingot.agent.hooks.enabled', installGitHooks: 'ingot.agent.hooks.installGitHooks' } as const;
/** Set by Ingot when it already ran the steps, so the installed git hook does not run them again. */
export const HOOKS_RAN_ENV = 'INGOT_HOOKS_RAN';
export const HOOK_MARKER = '# ingot-agent-hooks';
export const HOOK_RUNNER = 'ingot-hooks.cjs';
export const HOOK_TIMEOUT_SECONDS = 300;
export const AGENT_HOOK_MAX_DIFF = 12000;

export interface ShellHookStep { readonly name: string; readonly run: string; readonly timeoutSeconds?: number }
export interface AgentHookStep { readonly name: string; readonly agent: string }
export type HookStep = ShellHookStep | AgentHookStep;
export type HooksConfig = Readonly<Partial<Record<HookStage, readonly HookStep[]>>>;

export const isAgentStep = (step: HookStep): step is AgentHookStep => 'agent' in step;

export interface HookStepResult {
    readonly step: HookStep;
    readonly state: 'running' | 'passed' | 'failed' | 'skipped';
    readonly output: string;
    readonly exitCode?: number;
    readonly startedAt: number;
    readonly endedAt?: number;
}

export interface HooksParse { readonly config: HooksConfig; readonly errors: readonly string[] }

/** Reads `.ingot/hooks.json`; bad steps are dropped with a readable error, never thrown. */
export const parseHooks = (text: string | undefined): HooksParse => {
    if (!text?.trim()) {
        return { config: {}, errors: [] };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { config: {}, errors: [`${HOOKS_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { config: {}, errors: [`${HOOKS_FILE} must be an object with "pre-commit" and/or "pre-push" lists.`] };
    }
    const errors: string[] = [];
    const config: Partial<Record<HookStage, HookStep[]>> = {};
    for (const stage of HOOK_STAGES) {
        const list = (raw as Record<string, unknown>)[stage];
        if (list === undefined) {
            continue;
        }
        if (!Array.isArray(list)) {
            errors.push(`"${stage}" must be a list of steps.`);
            continue;
        }
        config[stage] = list.flatMap((item: unknown, i): HookStep[] => {
            const step = typeof item === 'string' ? { run: item } : item as Record<string, unknown>;
            const name = typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : undefined;
            if (step && typeof step.run === 'string' && step.run.trim()) {
                const timeout = typeof step.timeoutSeconds === 'number' && step.timeoutSeconds > 0 ? { timeoutSeconds: step.timeoutSeconds } : {};
                return [{ name: name ?? step.run.trim().split('\n')[0].slice(0, 48), run: step.run.trim(), ...timeout }];
            }
            if (step && typeof step.agent === 'string' && step.agent.trim()) {
                return [{ name: name ?? 'Agent check', agent: step.agent.trim() }];
            }
            errors.push(`"${stage}" step ${i + 1} needs "run" (a command) or "agent" (a prompt).`);
            return [];
        });
    }
    for (const key of Object.keys(raw as object)) {
        if (!(HOOK_STAGES as readonly string[]).includes(key) && key !== '$schema' && key !== 'description') {
            errors.push(`Unknown hook "${key}" (use "pre-commit" or "pre-push").`);
        }
    }
    return { config, errors };
};

export const hooksTemplate = (): string => `${JSON.stringify({
    description: 'Ingot agent hooks: shell steps ("run") and agent checks ("agent") before a commit or push. A failing step blocks it.',
    'pre-commit': [
        { name: 'Lint', run: 'npm run lint --if-present' },
        { name: 'Review the diff', agent: 'Check the staged diff for leftover debug code, secrets or TODOs that should not be committed.' }
    ],
    'pre-push': [
        { name: 'Tests', run: 'npm test --if-present' }
    ]
}, undefined, 2)}\n`;

/** The prompt for an agent step: the check, the diff, and the answer format. */
export const agentHookPrompt = (step: AgentHookStep, stage: HookStage, diff: string): string => {
    const trimmed = diff.length > AGENT_HOOK_MAX_DIFF ? `${diff.slice(0, AGENT_HOOK_MAX_DIFF)}\n… (diff cut)` : diff;
    return [
        `You are a git ${stage} check. ${step.agent}`,
        'Answer on the first line with exactly PASS or FAIL: <one-line reason>. Then, for FAIL, list what to fix (short).',
        '', 'Diff:', '```diff', trimmed || '(no changes)', '```'
    ].join('\n');
};

/** PASS / FAIL from an agent step's answer; anything unclear fails safe. */
export const agentVerdict = (answer: string): { passed: boolean; reason: string } => {
    const first = answer.trim().split('\n')[0].replace(/^[*_`#\s]+|[*_`\s]+$/g, '');
    if (/^PASS\b/i.test(first)) {
        return { passed: true, reason: first.replace(/^PASS[:\s-]*/i, '') || 'Passed' };
    }
    if (/^FAIL\b/i.test(first)) {
        return { passed: false, reason: first.replace(/^FAIL[:\s-]*/i, '') || 'Failed' };
    }
    return { passed: false, reason: 'The agent did not answer PASS or FAIL.' };
};

/** The prompt "Fix with agent" sends to the chat. */
export const fixWithAgentPrompt = (stage: HookStage, failed: readonly HookStepResult[]): string => [
    `The ${stage} hook failed. Fix the problems so it passes, then tell me.`,
    ...failed.map(r => [
        '', `Step "${r.step.name}" ${isAgentStep(r.step) ? `(agent check: ${r.step.agent})` : `(command: ${r.step.run})`} failed${r.exitCode !== undefined ? ` with exit code ${r.exitCode}` : ''}:`,
        '```', r.output.trim().slice(-4000) || '(no output)', '```'
    ].join('\n'))
].join('\n');

/** The installed git hook: a few lines of sh that call Ingot's runner (shell steps only; agent steps run in Ingot). */
export const gitHookScript = (stage: HookStage): string => [
    '#!/bin/sh',
    HOOK_MARKER,
    '# Installed by Ingot. Runs the shell steps of .ingot/hooks.json; agent steps run when you commit or push from Ingot.',
    '# Turn it off in Settings > AI & Zaprex > Agent git hooks.',
    `[ "$${HOOKS_RAN_ENV}" = "1" ] && exit 0`,
    'command -v node >/dev/null 2>&1 || exit 0',
    `exec node "$(git rev-parse --git-common-dir)/${HOOK_RUNNER}" ${stage} "$@"`,
    ''
].join('\n');

/** Node runner the git hook calls (CommonJS, no dependencies). */
export const gitHookRunner = (): string => `// ${HOOK_MARKER.slice(2)}: written by Ingot. Runs the shell steps of .ingot/hooks.json for one stage.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const stage = process.argv[2];
const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(root, '${HOOKS_FILE}'), 'utf8')); } catch { process.exit(0); }
const steps = Array.isArray(config[stage]) ? config[stage] : [];
for (const raw of steps) {
    const step = typeof raw === 'string' ? { run: raw } : raw || {};
    const name = step.name || step.run || 'Agent check';
    if (typeof step.run !== 'string') {
        console.log('[ingot] ' + stage + ' · ' + name + ': skipped (agent steps run when you commit or push from Ingot)');
        continue;
    }
    console.log('[ingot] ' + stage + ' · ' + name + ': ' + step.run);
    const result = spawnSync(step.run, { cwd: root, shell: true, stdio: 'inherit', timeout: (step.timeoutSeconds || ${HOOK_TIMEOUT_SECONDS}) * 1000 });
    if (result.status !== 0) {
        console.error('[ingot] ' + stage + ' failed at "' + name + '" (exit ' + result.status + '). Fix it, or bypass with --no-verify.');
        process.exit(result.status || 1);
    }
}
`;

/** True when an existing hook file is one Ingot wrote (safe to replace or remove). */
export const isIngotHook = (text: string | undefined): boolean => !!text && text.includes(HOOK_MARKER);

/** A hook step drawn as a tool card: shell steps as terminal blocks, agent checks as compact cards. */
export const hookCardInfo = (r: HookStepResult, stage: string): { info: import('../agents/tool-cards').ToolCallInfo; text: string } => {
    const state = r.state === 'running' ? 'running' : r.state === 'failed' ? 'error' : 'done';
    const base = { server: 'ingot', state, startedAt: r.startedAt || Date.now(), endedAt: r.endedAt } as const;
    if (isAgentStep(r.step)) {
        return { info: { ...base, tool: 'hook', args: { check: `${stage} · ${r.step.name}: ${r.step.agent}` } }, text: r.state === 'skipped' ? 'Not run (an earlier step failed).' : r.output };
    }
    const text = r.state === 'skipped' ? 'Not run (an earlier step failed).\nExit code ?.' : `${r.output}${r.exitCode !== undefined ? `\nExit code ${r.exitCode}.` : ''}`;
    return { info: { ...base, tool: 'run', args: { command: r.step.run, description: `${stage} · ${r.step.name}` } }, text };
};
