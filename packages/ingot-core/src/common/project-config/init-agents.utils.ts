import { FOLDER_ROLES, MAX_FOLDERS, MAX_SCRIPTS, SCRIPT_ORDER, STACK_DEPENDENCIES, STACK_FILES } from './init-agents.consts';
import type { RepoSignals } from './init-agents.types';

/** Languages, frameworks and tools the repo uses, from its dependencies and root marker files. */
export const detectStack = (signals: Pick<RepoSignals, 'dependencies' | 'files'>): string[] => {
    const deps = new Set(signals.dependencies);
    const files = new Set(signals.files);
    const labels = [
        ...STACK_FILES.filter(s => s.files.some(f => files.has(f))).map(s => s.label),
        ...STACK_DEPENDENCIES.filter(s => s.deps.some(d => deps.has(d))).map(s => s.label)
    ];
    if (!labels.length && files.has('package.json')) {
        labels.push('Node.js');
    }
    return [...new Set(labels)];
};

const runScript = (manager: string, script: string): string =>
    manager === 'npm' ? (script === 'test' || script === 'start' ? `npm ${script}` : `npm run ${script}`) : `${manager} ${script}`;

/** Most-used scripts first, then the rest in file order. */
export const orderedScripts = (scripts: Readonly<Record<string, string>>): [string, string][] => {
    const known = SCRIPT_ORDER.filter(s => s in scripts).map((s): [string, string] => [s, scripts[s]]);
    const rest = Object.entries(scripts).filter(([name]) => !(SCRIPT_ORDER as readonly string[]).includes(name) && !/^(pre|post)/.test(name));
    return [...known, ...rest].slice(0, MAX_SCRIPTS);
};

/** IDEA-295: AGENTS.md drafted from the repo, for the user to edit. */
export const scaffoldAgentsMd = (signals: RepoSignals): string => {
    const manager = signals.packageManager ?? 'npm';
    const stack = detectStack(signals);
    const scripts = orderedScripts(signals.scripts);
    const folders = signals.folders.slice(0, MAX_FOLDERS);
    const lines = [`# AGENTS.md — ${signals.name}`, ''];
    lines.push(signals.description ? signals.description : 'Instructions for AI agents working in this repository.', '');
    if (stack.length) {
        lines.push('## Stack', '', ...stack.map(s => `- ${s}`), '');
    }
    if (scripts.length) {
        lines.push('## Scripts', '', `Package manager: ${manager}. Run these from the repository root:`, '');
        lines.push(...scripts.map(([name, command]) => `- \`${runScript(manager, name)}\` — ${command}`), '');
    }
    if (folders.length || signals.workspaces?.length) {
        lines.push('## Layout', '');
        lines.push(...folders.map(f => `- \`${f}/\`${FOLDER_ROLES[f] ? ` — ${FOLDER_ROLES[f]}` : ''}`));
        if (signals.workspaces?.length) {
            lines.push(`- Workspaces: ${signals.workspaces.map(w => `\`${w}\``).join(', ')}`);
        }
        lines.push('');
    }
    lines.push('## Working here', '');
    const check = ['lint', 'typecheck', 'test'].filter(s => s in signals.scripts).map(s => `\`${runScript(manager, s)}\``);
    lines.push(check.length ? `- Before finishing a change, run ${check.join(', ')}.` : '- Before finishing a change, build and test it.');
    lines.push('- Keep changes small and focused; match the style of the code around them.');
    if (signals.rules.length) {
        lines.push(`- Also follow the project rules: ${signals.rules.map(r => `\`${r}\``).join(', ')}.`);
    }
    lines.push('');
    return lines.join('\n');
};

/** Reads the parts of package.json `/init` uses; undefined when it is missing or not JSON. */
export const packageSignals = (text: string | undefined): Pick<RepoSignals, 'scripts' | 'dependencies'> & { name?: string; description?: string; workspaces?: string[] } | undefined => {
    if (!text) {
        return undefined;
    }
    try {
        const json = JSON.parse(text) as Record<string, unknown>;
        const record = (v: unknown): Record<string, string> => v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).filter(([, val]) => typeof val === 'string')) as Record<string, string> : {};
        const workspaces = Array.isArray(json.workspaces) ? json.workspaces.filter((w): w is string => typeof w === 'string')
            : Array.isArray((json.workspaces as { packages?: unknown })?.packages) ? ((json.workspaces as { packages: unknown[] }).packages).filter((w): w is string => typeof w === 'string') : undefined;
        return {
            scripts: record(json.scripts),
            dependencies: [...Object.keys(record(json.dependencies)), ...Object.keys(record(json.devDependencies))],
            ...(typeof json.name === 'string' && json.name ? { name: json.name } : {}),
            ...(typeof json.description === 'string' && json.description ? { description: json.description } : {}),
            ...(workspaces?.length ? { workspaces } : {})
        };
    } catch {
        return undefined;
    }
};
