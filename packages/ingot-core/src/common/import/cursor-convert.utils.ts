import { parseFrontmatter } from '../project-config/project-config.utils';
import {
    AGENTS_RULE_NAME, CONVERTED_RULE_EXT, CURSOR_HOOKS_PATH, CURSOR_ITEM_LABELS, CURSORRULES_TARGET, INGOT_HOOKS_PATH, MERGE_TARGETS
} from './cursor-convert.consts';
import type { CursorConversionInput, CursorConversionPlan, CursorConversionStep, CursorItemKind, CursorSourceFile } from './cursor-convert.types';
import { convertCursorRule, convertCursorrules } from './cursor-rules-import.utils';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);

const parseJson = (text: string | undefined): JsonObject | undefined => {
    try {
        const value = JSON.parse(text ?? '') as unknown;
        return isObject(value) ? value : undefined;
    } catch {
        return undefined;
    }
};

const json = (value: unknown): string => `${JSON.stringify(value, undefined, 2)}\n`;

/** Same rule whatever the extension: `.ingot/rules/ts.md` and `.ingot/rules/ts.mdc` are one rule. */
const ruleKey = (path: string): string => path.replace(/\.(md|mdc)$/i, '').toLowerCase();

/** An AGENTS.md as an always-on Ingot rule. */
export const convertAgentsMd = (text: string): string => `---\nalwaysApply: true\n---\n${parseFrontmatter(text).body}\n`;

/** Hook commands pointing at `.cursor/hooks/x.sh` now point at the copy in `.ingot/hooks/`. */
export const translateHookCommand = (command: string): string => command.split(CURSOR_HOOKS_PATH).join(INGOT_HOOKS_PATH);

/** `.cursor/mcp.json` servers added to `.ingot/mcp.json`; a server already in `.ingot` wins. Unknown keys are kept. */
export const mergeMcpJson = (cursorText: string, ingotText: string | undefined): { text?: string; added: string[]; error?: string } => {
    const cursor = parseJson(cursorText);
    const ingot = ingotText === undefined ? {} : parseJson(ingotText);
    if (!cursor || !ingot) {
        return { added: [], error: `${cursor ? MERGE_TARGETS.mcp : '.cursor/mcp.json'} is not valid JSON.` };
    }
    const from = isObject(cursor.mcpServers) ? cursor.mcpServers : {};
    const into = isObject(ingot.mcpServers) ? ingot.mcpServers : {};
    const added = Object.keys(from).filter(name => !(name in into));
    return added.length ? { text: json({ ...ingot, mcpServers: { ...into, ...Object.fromEntries(added.map(name => [name, from[name]])) } }), added } : { added };
};

/** `.cursor/hooks.json` agent hooks appended to `.ingot/hooks.json` (git stages there stay as they are). */
export const mergeHooksJson = (cursorText: string, ingotText: string | undefined): { text?: string; added: number; error?: string } => {
    const cursor = parseJson(cursorText);
    const ingot = ingotText === undefined ? {} : parseJson(ingotText);
    if (!cursor || !ingot) {
        return { added: 0, error: `${cursor ? MERGE_TARGETS.hooks : '.cursor/hooks.json'} is not valid JSON.` };
    }
    const from = isObject(cursor.hooks) ? cursor.hooks : {};
    const into: Record<string, unknown[]> = Object.fromEntries(Object.entries(isObject(ingot.hooks) ? ingot.hooks : {}).map(([k, v]) => [k, Array.isArray(v) ? [...v] : []]));
    const commandOf = (entry: unknown): string => typeof entry === 'string' ? entry : isObject(entry) && typeof entry.command === 'string' ? entry.command : '';
    let added = 0;
    for (const [event, list] of Object.entries(from)) {
        for (const entry of Array.isArray(list) ? list : []) {
            const command = translateHookCommand(commandOf(entry));
            const target = into[event] ?? [];
            if (command && !target.some(existing => commandOf(existing) === command)) {
                into[event] = [...target, isObject(entry) ? { ...entry, command } : { command }];
                added++;
            }
        }
    }
    const version = ingot.version ?? cursor.version;
    return added ? { text: json({ ...(version !== undefined ? { version } : {}), ...ingot, hooks: into }), added } : { added };
};

/** Ignore patterns from the Cursor file that the Ingot file does not have yet, appended under a comment. */
export const mergeIgnoreText = (cursorText: string, ingotText: string | undefined, from: string): string | undefined => {
    if (ingotText === undefined) {
        return cursorText.trim() ? cursorText : undefined;
    }
    const have = new Set(ingotText.split(/\r?\n/).map(line => line.trim()));
    const missing = cursorText.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && !have.has(line));
    return missing.length ? `${ingotText.replace(/\s*$/, '')}\n\n# From ${from}\n${missing.join('\n')}\n` : undefined;
};

interface Mapping { readonly kind: CursorItemKind; readonly target: string; readonly convert?: (text: string) => string }

/** Where a Cursor file goes in `.ingot`, or undefined for files that are not converted. */
export const cursorTargetFor = (path: string): Mapping | undefined => {
    const rule = /^(.*\/)?\.cursor\/rules\/(.+)\.(md|mdc)$/i.exec(path);
    if (rule) {
        return { kind: 'rule', target: `${rule[1] ?? ''}.ingot/rules/${rule[2]}${CONVERTED_RULE_EXT}`, convert: convertCursorRule };
    }
    const agents = /^(.*\/)?AGENTS\.md$/.exec(path);
    if (agents) {
        return { kind: 'rule', target: `${agents[1] ?? ''}.ingot/rules/${AGENTS_RULE_NAME}${CONVERTED_RULE_EXT}`, convert: convertAgentsMd };
    }
    const bugbot = /^(.*\/)?\.cursor\/BUGBOT\.md$/.exec(path);
    if (bugbot) {
        return { kind: 'bugbot', target: `${bugbot[1] ?? ''}.ingot/BUGBOT.md`, convert: text => text };
    }
    if (path === '.cursorrules') {
        return { kind: 'rule', target: CURSORRULES_TARGET, convert: convertCursorrules };
    }
    const folder = /^\.cursor\/(commands|skills|hooks|habits)\/(.+)$/.exec(path);
    if (folder) {
        const kind: CursorItemKind = folder[1] === 'commands' ? 'command' : folder[1] === 'skills' ? 'skill' : folder[1] === 'hooks' ? 'hookScript' : 'habit';
        return { kind, target: `.ingot/${folder[1]}/${folder[2]}`, ...(kind === 'command' ? { convert: (text: string) => text } : {}) };
    }
    if (path === '.cursor/environment.json') {
        return { kind: 'environment', target: '.ingot/environment.json', convert: text => text };
    }
    return undefined;
};

/**
 * IDEA-287: "Convert to .ingot". Every Cursor file gets an `.ingot` counterpart; files already in `.ingot` are never
 * overwritten (rules match by name whatever the extension), mcp.json / hooks.json / ignore files are merged.
 */
export const planCursorConversion = (input: CursorConversionInput): CursorConversionPlan => {
    const existing = new Set(input.existing.map(ruleKey));
    const taken = (target: string): boolean => existing.has(ruleKey(target));
    const steps: CursorConversionStep[] = [];
    const skipped: { from: string; reason: string }[] = [];
    const sources = [...input.sources].sort((a, b) => a.path.localeCompare(b.path));
    const textOf = (source: CursorSourceFile): string => source.text ?? '';
    for (const source of sources) {
        if (source.path === '.cursor/mcp.json') {
            const merged = mergeMcpJson(textOf(source), input.current[MERGE_TARGETS.mcp]);
            if (merged.error) {
                skipped.push({ from: source.path, reason: merged.error });
            } else if (merged.text) {
                steps.push({ kind: 'mcp', from: source.path, target: MERGE_TARGETS.mcp, text: merged.text, merge: input.current[MERGE_TARGETS.mcp] !== undefined });
            }
            continue;
        }
        if (source.path === '.cursor/hooks.json') {
            const merged = mergeHooksJson(textOf(source), input.current[MERGE_TARGETS.hooks]);
            if (merged.error) {
                skipped.push({ from: source.path, reason: merged.error });
            } else if (merged.text) {
                steps.push({ kind: 'hooks', from: source.path, target: MERGE_TARGETS.hooks, text: merged.text, merge: input.current[MERGE_TARGETS.hooks] !== undefined });
            }
            continue;
        }
        if (source.path === '.cursorignore' || source.path === '.cursorindexingignore') {
            const target = MERGE_TARGETS[source.path];
            const text = mergeIgnoreText(textOf(source), input.current[target], source.path);
            if (text !== undefined) {
                steps.push({ kind: 'ignore', from: source.path, target, text, merge: input.current[target] !== undefined });
            }
            continue;
        }
        const mapping = cursorTargetFor(source.path);
        if (!mapping || taken(mapping.target)) {
            continue;
        }
        existing.add(ruleKey(mapping.target));
        steps.push({ kind: mapping.kind, from: source.path, target: mapping.target, ...(mapping.convert ? { text: mapping.convert(textOf(source)) } : {}) });
    }
    return { steps, skipped };
};

/** "4 rules, 1 command, mcp.json and .ingotignore" for the notification after a conversion. */
export const conversionSummary = (steps: readonly CursorConversionStep[]): string => {
    const counts = new Map<CursorItemKind, number>();
    steps.forEach(step => counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1));
    const parts = [...counts.entries()].map(([kind, count]) => {
        const [one, many] = CURSOR_ITEM_LABELS[kind];
        return one.includes('.') ? (count === 1 ? one : `${count} ${many}`) : `${count} ${count === 1 ? one : many}`;
    });
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
};
