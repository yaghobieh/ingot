import { CHARS_PER_TOKEN, RULE_EXTENSIONS, RULES_DIR } from './rules-kit.consts';
import type { KitProject, KitRule } from './rules-kit.types';

type FrontmatterValue = string | boolean | string[];

const unquote = (value: string): string => value.trim().replace(/^["']|["']$/g, '');

const parseValue = (raw: string): FrontmatterValue => {
    const value = raw.trim();
    if (value === 'true' || value === 'false') {
        return value === 'true';
    }
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    }
    return unquote(value);
};

/** Rule frontmatter (`key: value`, booleans, `[a, b]` and `- item` lists), the same subset Ingot reads in the IDE. */
export const parseFrontmatter = (text: string): { data: Record<string, FrontmatterValue>; body: string } => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match) {
        return { data: {}, body: text.trim() };
    }
    const data: Record<string, FrontmatterValue> = {};
    let listKey: string | undefined;
    for (const line of match[1].split(/\r?\n/)) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item && listKey) {
            const list = Array.isArray(data[listKey]) ? data[listKey] as string[] : [];
            data[listKey] = [...list, unquote(item[1])];
            continue;
        }
        const pair = /^([\w-]+):\s*(.*)$/.exec(line);
        if (pair) {
            listKey = pair[2].trim() ? undefined : pair[1];
            data[pair[1]] = pair[2].trim() ? parseValue(pair[2]) : [];
        }
    }
    return { data, body: text.slice(match[0].length).trim() };
};

export const asList = (value: FrontmatterValue | undefined): string[] =>
    Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];

export const isRuleFile = (path: string): boolean =>
    path.startsWith(RULES_DIR) && RULE_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));

/** `.ingot/rules/backend/api.mdc` → `backend-api`. */
export const ruleName = (path: string): string =>
    path.slice(RULES_DIR.length).replace(/\.(md|mdc)$/i, '').split('/').join('-').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

/** A rule without globs (and without `alwaysApply: false`) always applies, like AGENTS.md; with globs it applies to matching files. */
export const ruleFromText = (path: string, text: string): KitRule => {
    const { data, body } = parseFrontmatter(text);
    const globs = asList(data.globs);
    const alwaysApply = data.alwaysApply === true || (data.alwaysApply === undefined && globs.length === 0);
    const description = typeof data.description === 'string' && data.description ? data.description : undefined;
    return { name: ruleName(path), path, globs, alwaysApply, body, data, ...(description ? { description } : {}) };
};

/** Every rule under `.ingot/rules/` (nested folders too), sorted by path so output is deterministic. */
export const loadRules = (project: KitProject): KitRule[] =>
    project.files.filter(isRuleFile).sort().flatMap(path => {
        const text = project.read(path);
        return text === undefined ? [] : [ruleFromText(path, text)];
    });

const escapeRegExp = (text: string): string => text.replace(/[.+^$()|[\]\\]/g, '\\$&');

const globRegExp = (glob: string): RegExp => {
    let pattern = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            const slash = glob[i + 2] === '/';
            pattern += slash ? '(?:.*/)?' : '.*';
            i += slash ? 2 : 1;
        } else if (c === '*') {
            pattern += '[^/]*';
        } else if (c === '?') {
            pattern += '[^/]';
        } else if (c === '{' && glob.indexOf('}', i) > i) {
            const end = glob.indexOf('}', i);
            pattern += `(?:${glob.slice(i + 1, end).split(',').map(escapeRegExp).join('|')})`;
            i = end;
        } else {
            pattern += escapeRegExp(c);
        }
    }
    return new RegExp(`^${pattern}$`);
};

/** Glob match for project-relative paths (`**`, `*`, `?`, `{a,b}`). A glob without `/` matches the file name anywhere. */
export const matchGlob = (glob: string, path: string): boolean => {
    const normalized = path.replace(/^\.\//, '');
    const clean = glob.trim().replace(/^\.\//, '');
    const re = globRegExp(clean);
    return re.test(normalized) || (!clean.includes('/') && re.test(normalized.split('/').pop() ?? ''));
};

/** Rules for a turn: the named ones if given, otherwise always-on rules plus rules whose globs match a file in context. */
export const selectRules = (rules: readonly KitRule[], files: readonly string[], names?: readonly string[]): KitRule[] =>
    names?.length
        ? rules.filter(rule => names.includes(rule.name))
        : rules.filter(rule => rule.alwaysApply || rule.globs.some(glob => files.some(file => matchGlob(glob, file))));

export const formatRulesForPrompt = (rules: readonly KitRule[]): string =>
    rules.length ? `Project rules (follow them):\n\n${rules.map(rule => `## ${rule.name}\n${rule.body}`).join('\n\n')}` : '';

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Lines added and removed between two texts (multiset count, good enough for a "+3 −1" summary). */
export const lineDelta = (before: string | undefined, after: string | undefined): { added: number; removed: number } => {
    const count = (text: string | undefined) => {
        const counts = new Map<string, number>();
        for (const line of text ? text.split('\n') : []) {
            counts.set(line, (counts.get(line) ?? 0) + 1);
        }
        return counts;
    };
    const a = count(before);
    const b = count(after);
    let added = 0;
    let removed = 0;
    for (const [line, n] of b) {
        added += Math.max(0, n - (a.get(line) ?? 0));
    }
    for (const [line, n] of a) {
        removed += Math.max(0, n - (b.get(line) ?? 0));
    }
    return { added, removed };
};
