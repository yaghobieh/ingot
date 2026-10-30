/**
 * IDEA-259: pure helpers for the agent's language-server tools: where a symbol is in a file, how text edits apply,
 * and how definitions, references and diagnostics read in a tool result.
 */
import {
    CODE_EDIT_TOOLS, CODE_TOOL_NAMES, CODE_TOOL_STEPS, IDENTIFIER_RE, LSP_SEVERITIES, MAX_CODE_LOCATIONS, MAX_DIAGNOSTICS, PREVIEW_MAX_CHARS, SEVERITY_ORDER
} from './code-tools.consts';
import type { CodeDiagnostic, CodeLocation, CodePosition, CodeSeverity, CodeTextEdit, CodeToolName, SymbolTarget } from './code-tools.types';

export const isCodeTool = (name: string): name is CodeToolName => (CODE_TOOL_NAMES as readonly string[]).includes(name);
export const isCodeEditTool = (name: string): boolean => (CODE_EDIT_TOOLS as readonly string[]).includes(name);

const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const positiveInt = (value: unknown): number | undefined => {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Reads `{path, symbol?, line?, column?}`; a symbol or a line is required. */
export const parseSymbolTarget = (args: Readonly<Record<string, unknown>>): SymbolTarget | { readonly error: string } => {
    const path = str(args.path) || str(args.file);
    const symbol = str(args.symbol) || str(args.name);
    const line = positiveInt(args.line);
    const column = positiveInt(args.column) ?? positiveInt(args.character);
    if (!path) {
        return { error: 'A "path" is required.' };
    }
    if (!symbol && !line) {
        return { error: 'Give a "symbol" (and optionally its "line") or a "line" and "column".' };
    }
    return { path, ...(symbol ? { symbol } : {}), ...(line ? { line } : {}), ...(column ? { column } : {}) };
};

/** The new name for rename_symbol, or an error for an empty or invalid identifier. */
export const parseNewName = (args: Readonly<Record<string, unknown>>): string | { readonly error: string } => {
    const name = str(args.new_name) || str(args.newName) || str(args.to);
    if (!name) {
        return { error: 'A "new_name" is required.' };
    }
    return IDENTIFIER_RE.test(name) ? name : { error: `"${name}" is not a valid identifier.` };
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the target points in the file text. A symbol is matched as a whole word, on its line when one is given
 * (the nearest line with it otherwise), else the first one in the file.
 */
export const findSymbolPosition = (text: string, target: SymbolTarget): CodePosition | undefined => {
    const lines = text.split('\n');
    if (!target.symbol) {
        if (!target.line || target.line > lines.length) {
            return undefined;
        }
        const max = lines[target.line - 1].length + 1;
        return { line: target.line, column: Math.min(target.column ?? 1, max) };
    }
    const word = new RegExp(`(?<![\\w$])${escapeRegExp(target.symbol)}(?![\\w$])`);
    const columnOn = (index: number): number | undefined => {
        const match = word.exec(lines[index] ?? '');
        return match ? match.index + 1 : undefined;
    };
    if (target.line) {
        const start = Math.min(target.line, lines.length) - 1;
        for (let distance = 0; distance < lines.length; distance++) {
            for (const index of distance ? [start - distance, start + distance] : [start]) {
                const column = index >= 0 && index < lines.length ? columnOn(index) : undefined;
                if (column) {
                    return { line: index + 1, column };
                }
            }
        }
        return undefined;
    }
    for (let index = 0; index < lines.length; index++) {
        const column = columnOn(index);
        if (column) {
            return { line: index + 1, column };
        }
    }
    return undefined;
};

/** Offset of a 1-based line and column, clamped to the text. */
const offsetAt = (starts: readonly number[], text: string, line: number, column: number): number => {
    if (line > starts.length) {
        return text.length;
    }
    const start = starts[Math.max(1, line) - 1];
    const end = line < starts.length ? starts[line] - 1 : text.length;
    return Math.min(start + Math.max(1, column) - 1, end);
};

/** Applies non-overlapping edits (all against the original text), last first. */
export const applyTextEdits = (text: string, edits: readonly CodeTextEdit[]): string => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            starts.push(i + 1);
        }
    }
    const spans = edits
        .map(edit => ({
            from: offsetAt(starts, text, edit.range.startLine, edit.range.startColumn),
            to: offsetAt(starts, text, edit.range.endLine, edit.range.endColumn),
            text: edit.text
        }))
        .sort((a, b) => b.from - a.from || b.to - a.to);
    let out = text;
    let floor = Number.POSITIVE_INFINITY;
    for (const span of spans) {
        if (span.to > floor) {
            continue;
        }
        out = `${out.slice(0, span.from)}${span.text}${out.slice(span.to)}`;
        floor = span.from;
    }
    return out;
};

export const previewLine = (line: string): string => {
    const one = line.trim();
    return one.length > PREVIEW_MAX_CHARS ? `${one.slice(0, PREVIEW_MAX_CHARS - 1)}…` : one;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** `path:line:column  text` rows, deduplicated, sorted by file and line, capped. */
export const formatLocations = (heading: string, locations: readonly CodeLocation[], max = MAX_CODE_LOCATIONS): string => {
    const seen = new Set<string>();
    const unique = locations.filter(location => {
        const key = `${location.path}:${location.range.startLine}:${location.range.startColumn}`;
        return seen.has(key) ? false : (seen.add(key), true);
    }).sort((a, b) => a.path.localeCompare(b.path) || a.range.startLine - b.range.startLine || a.range.startColumn - b.range.startColumn);
    if (!unique.length) {
        return `No ${heading} found.`;
    }
    const files = new Set(unique.map(location => location.path)).size;
    const shown = unique.slice(0, max);
    return [
        `${plural(unique.length, heading.replace(/s$/, ''))} in ${plural(files, 'file')}:`,
        ...shown.map(location => `${location.path}:${location.range.startLine}:${location.range.startColumn}  ${location.preview}`),
        ...(unique.length > shown.length ? [`… ${unique.length - shown.length} more`] : [])
    ].join('\n');
};

export const severityOf = (lsp: unknown): CodeSeverity => (typeof lsp === 'number' ? LSP_SEVERITIES[lsp] : undefined) ?? 'error';

/** Wanted severity from the tool arguments: "error" keeps errors, "warning" keeps errors and warnings. */
export const severityFilter = (raw: unknown): ((severity: CodeSeverity) => boolean) => {
    const wanted = SEVERITY_ORDER.indexOf(str(raw).toLowerCase() as CodeSeverity);
    return severity => wanted < 0 || SEVERITY_ORDER.indexOf(severity) <= wanted;
};

/** Problems list text: a count line, then `path:line:column severity message (source code)`, errors first. */
export const formatDiagnostics = (diagnostics: readonly CodeDiagnostic[], scope: string, max = MAX_DIAGNOSTICS): string => {
    if (!diagnostics.length) {
        return `No problems in ${scope}.`;
    }
    const sorted = [...diagnostics].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
        || a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
    const counts = SEVERITY_ORDER.map(severity => ({ severity, count: sorted.filter(d => d.severity === severity).length })).filter(c => c.count);
    const shown = sorted.slice(0, max);
    return [
        `${counts.map(c => plural(c.count, c.severity)).join(', ')} in ${scope}:`,
        ...shown.map(d => {
            const origin = [d.source, d.code].filter(Boolean).join(' ');
            return `${d.path}:${d.line}:${d.column} ${d.severity} ${d.message.replace(/\s+/g, ' ').trim()}${origin ? ` (${origin})` : ''}`;
        }),
        ...(sorted.length > shown.length ? [`… ${sorted.length - shown.length} more`] : [])
    ].join('\n');
};

/** Short card detail: `useCart → useBasket · src/cart.ts`, `add · src/math.ts`, or the path. */
export const codeToolDetail = (tool: string, args: Readonly<Record<string, unknown>>): string => {
    const path = str(args.path) || str(args.file);
    const symbol = str(args.symbol) || str(args.name) || (positiveInt(args.line) ? `line ${positiveInt(args.line)}` : '');
    const subject = tool === 'rename_symbol' && symbol ? `${symbol} → ${str(args.new_name) || str(args.newName) || '?'}` : symbol;
    return [subject, path].filter(Boolean).join(' · ') || (tool === 'diagnostics' ? 'whole project' : '');
};

/** Checklist row: `Find references: add · src/math.ts`. */
export const codeToolStep = (tool: CodeToolName, args: Readonly<Record<string, unknown>>): string => {
    const detail = codeToolDetail(tool, args);
    return detail ? `${CODE_TOOL_STEPS[tool]}: ${detail}` : CODE_TOOL_STEPS[tool];
};
