import type { FrontmatterEntry, FrontmatterItem, FrontmatterProblem, FrontmatterValue, ParsedFrontmatter, TextRange } from './rules-engine.types';

const FENCE = /^---\s*$/;
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(.*)$/;
const LIST_ITEM = /^(\s*)-\s+(.*)$/;
const QUOTED = /^(["'])(.*)\1$/;

export const range = (line: number, column: number, endColumn: number, endLine = line): TextRange => ({ line, column, endLine, endColumn });

const unquote = (value: string): string => QUOTED.exec(value)?.[2] ?? value;

/** Comma-separated parts of `text` (which starts at `column`), each with its own range; commas in quotes or `{a,b}` stay. */
const splitItems = (text: string, line: number, column: number): FrontmatterItem[] => {
    const items: FrontmatterItem[] = [];
    let start = 0;
    let quote: string | undefined;
    let braces = 0;
    for (let i = 0; i <= text.length; i++) {
        const c = text[i];
        if (quote) {
            quote = c === quote ? undefined : quote;
            continue;
        }
        if (c === '"' || c === '\'') {
            quote = c;
            continue;
        }
        braces += c === '{' ? 1 : c === '}' ? -1 : 0;
        if (i === text.length || (c === ',' && braces <= 0)) {
            const raw = text.slice(start, i);
            const lead = raw.length - raw.trimStart().length;
            const value = unquote(raw.trim());
            if (value) {
                items.push({ value, range: range(line, column + start + lead, column + start + lead + raw.trim().length) });
            }
            start = i + 1;
        }
    }
    return items;
};

const scalar = (raw: string): boolean | string => raw === 'true' ? true : raw === 'false' ? false : unquote(raw);

interface Pending {
    key: string;
    keyRange: TextRange;
    valueRange: TextRange;
    items: FrontmatterItem[];
}

/**
 * YAML-style frontmatter as rules, commands, skills and habits use it (`key: value`, `true`/`false`, `[a, b]` and
 * `- item` lists), with the position of every key and value so editors can underline them.
 */
export const parseFrontmatterBlock = (text: string): ParsedFrontmatter => {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const none: ParsedFrontmatter = { present: false, unclosed: false, entries: [], data: {}, body: text.trim(), bodyLine: 0, endLine: -1, problems: [] };
    if (!lines.length || !FENCE.test(lines[0])) {
        return none;
    }
    const endLine = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
    const last = endLine < 0 ? lines.length : endLine;
    const entries: FrontmatterEntry[] = [];
    const problems: FrontmatterProblem[] = [];
    let pending: Pending | undefined;
    const flush = (): void => {
        if (pending) {
            entries.push({ key: pending.key, keyRange: pending.keyRange, valueRange: pending.valueRange, items: pending.items, value: pending.items.length ? pending.items.map(i => i.value) : '' });
            pending = undefined;
        }
    };
    for (let line = 1; line < last; line++) {
        const content = lines[line];
        if (!content.trim() || content.trimStart().startsWith('#')) {
            continue;
        }
        const item = LIST_ITEM.exec(content);
        if (item && pending) {
            const value = unquote(item[2].trim());
            const column = item[1].length + content.slice(item[1].length).indexOf(item[2]);
            pending.items.push({ value, range: range(line, column, column + item[2].trim().length) });
            continue;
        }
        flush();
        const pair = KEY_LINE.exec(content);
        if (!pair) {
            problems.push({ message: 'Expected "key: value".', range: range(line, 0, content.length) });
            continue;
        }
        const key = pair[1];
        const keyRange = range(line, 0, key.length);
        const rawValue = pair[2].trim();
        const valueColumn = content.length - pair[2].trimStart().length;
        const valueRange = range(line, rawValue ? valueColumn : content.length, rawValue ? valueColumn + rawValue.length : content.length);
        if (entries.some(e => e.key === key)) {
            problems.push({ message: `Duplicate key "${key}".`, range: keyRange });
        }
        if (!rawValue) {
            pending = { key, keyRange, valueRange, items: [] };
            continue;
        }
        let value: FrontmatterValue;
        let items: FrontmatterItem[];
        if (rawValue.startsWith('[')) {
            if (!rawValue.endsWith(']')) {
                problems.push({ message: 'List is missing its closing "]".', range: valueRange });
            }
            const inner = rawValue.slice(1, rawValue.endsWith(']') ? -1 : undefined);
            items = splitItems(inner, line, valueColumn + 1);
            value = items.map(i => i.value);
        } else {
            value = scalar(rawValue);
            items = typeof value === 'string' ? splitItems(rawValue, line, valueColumn) : [];
        }
        entries.push({ key, value, keyRange, valueRange, items });
    }
    flush();
    if (endLine < 0) {
        problems.push({ message: 'Frontmatter starts with "---" but is never closed.', range: range(0, 0, lines[0].length) });
    }
    const bodyLine = endLine < 0 ? lines.length : endLine + 1;
    return {
        present: true,
        unclosed: endLine < 0,
        entries,
        data: Object.fromEntries(entries.map(e => [e.key, e.value])),
        body: endLine < 0 ? '' : lines.slice(bodyLine).join('\n').trim(),
        bodyLine,
        endLine,
        problems
    };
};

/** A frontmatter value as a list (`[a, b]`, `- a`, or `a, b`). */
export const asList = (value: FrontmatterValue | undefined): string[] =>
    Array.isArray(value) ? [...value as readonly string[]] : typeof value === 'string' && value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];

export const asText = (value: FrontmatterValue | undefined): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const entryOf = (parsed: ParsedFrontmatter, key: string): FrontmatterEntry | undefined => parsed.entries.find(e => e.key === key);

/** The line of the first body line that is not blank (for findings about the body). */
export const firstBodyLine = (text: string, parsed: ParsedFrontmatter): number => {
    const lines = text.split(/\r?\n/);
    for (let i = parsed.bodyLine; i < lines.length; i++) {
        if (lines[i].trim()) {
            return i;
        }
    }
    return parsed.bodyLine;
};
