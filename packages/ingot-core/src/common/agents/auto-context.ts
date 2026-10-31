/**
 * IDEA-267 auto-context: the current file, selection, diagnostics, recent edits, git diff and memories, attached to a
 * prompt without the user asking. The browser service collects a snapshot; this module turns it into chips and text.
 */
import {
    AUTO_CONTEXT_HEADER, AUTO_CONTEXT_ORDER, DIAGNOSTIC_ORDER, DIFF_TRUNCATED, FILE_WINDOW_LINES, MAX_DIAGNOSTICS, MAX_DIFF_CHARS, MAX_EDIT_LINES,
    MAX_RECENT_EDITS, MAX_SELECTION_CHARS, RECENT_EDIT_MS
} from './auto-context.consts';
import type {
    AutoContextItem, AutoContextSnapshot, AutoDiagnostic, AutoEdit, AutoFile, DiffStat, SentAutoContext
} from './auto-context.types';
import { numberLines } from './workspace-tools';

const baseName = (path: string): string => path.split('/').pop() ?? path;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const fence = (text: string, lang = ''): string => `\`\`\`${lang}\n${text.replace(/\n$/, '')}\n\`\`\``;

/** The current file as sent: a window of numbered lines around the cursor. */
export const fileContext = (path: string, uri: string, content: string, cursorLine: number, window = FILE_WINDOW_LINES): AutoFile => {
    const total = content.split('\n').length;
    const cursor = Math.min(Math.max(1, cursorLine), total);
    const start = Math.max(1, cursor - window);
    const shown = numberLines(content, start, Math.min(total, cursor + window));
    return { path, uri, cursorLine: cursor, excerpt: shown.text, excerptStart: shown.shown[0], lineCount: total };
};

export const diffStat = (diff: string): DiffStat => {
    let files = 0;
    let added = 0;
    let removed = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            files++;
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            added++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            removed++;
        }
    }
    return { files, added, removed };
};

export const clipText = (text: string, max: number, mark = DIFF_TRUNCATED): string =>
    text.length > max ? `${text.slice(0, max).replace(/\n[^\n]*$/, '')}\n${mark}` : text;

/** Remembers an edit to `path` (newest first, one entry per file, lines deduplicated). */
export const recordEdit = (edits: readonly AutoEdit[], path: string, lines: readonly number[], now: number, max = MAX_RECENT_EDITS): AutoEdit[] => {
    const previous = edits.find(e => e.path === path);
    const merged = [...(previous?.lines ?? []).filter(l => !lines.includes(l)), ...lines].slice(-MAX_EDIT_LINES);
    return [{ path, at: now, lines: merged }, ...edits.filter(e => e.path !== path)].slice(0, max);
};

export const recentEdits = (edits: readonly AutoEdit[], now: number, maxAge = RECENT_EDIT_MS): AutoEdit[] =>
    edits.filter(e => now - e.at <= maxAge);

/** Errors before warnings, the current file first, then by path and line; capped. */
export const sortDiagnostics = (diagnostics: readonly AutoDiagnostic[], currentPath?: string, max = MAX_DIAGNOSTICS): AutoDiagnostic[] =>
    [...diagnostics].sort((a, b) =>
        DIAGNOSTIC_ORDER[a.severity] - DIAGNOSTIC_ORDER[b.severity]
        || Number(b.path === currentPath) - Number(a.path === currentPath)
        || a.path.localeCompare(b.path)
        || a.line - b.line
    ).slice(0, max);

const diagnosticsLabel = (diagnostics: readonly AutoDiagnostic[]): string => {
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    const parts = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean);
    return parts.length ? parts.join(', ') : plural(diagnostics.length, 'problem');
};

const formatDiagnostic = (d: AutoDiagnostic): string => `- ${d.path}:${d.line} ${d.severity}: ${d.message}${d.source ? ` (${d.source})` : ''}`;

/** Chips for a snapshot, in a stable order. Empty parts make no chip. */
export const autoContextItems = (snapshot: AutoContextSnapshot): AutoContextItem[] => {
    const items: AutoContextItem[] = [];
    const { file, selection } = snapshot;
    if (selection && selection.text.trim()) {
        const range = selection.start === selection.end ? `${selection.start}` : `${selection.start}-${selection.end}`;
        const text = clipText(selection.text, MAX_SELECTION_CHARS, '… (selection cut)');
        items.push({
            key: `selection:${selection.path}:${range}`, kind: 'selection', label: `${baseName(selection.path)} (${range})`,
            title: `Selection in ${selection.path}, lines ${range}`, uri: selection.uri, line: selection.start,
            text: `Selected in ${selection.path} (lines ${range}):\n${fence(text)}`
        });
    }
    if (file) {
        const end = file.excerptStart + file.excerpt.split('\n').length - 1;
        items.push({
            key: `file:${file.path}`, kind: 'file', label: baseName(file.path),
            title: `Current file ${file.path} · cursor on line ${file.cursorLine}`, uri: file.uri, line: file.cursorLine,
            text: `Current file: ${file.path} (${file.lineCount} lines, cursor on line ${file.cursorLine}). Lines ${file.excerptStart}-${end}:\n${fence(file.excerpt)}`
        });
    }
    if (snapshot.diagnostics.length) {
        const list = sortDiagnostics(snapshot.diagnostics, file?.path);
        const first = list[0];
        items.push({
            key: `diagnostics:${snapshot.diagnostics.length}:${first.path}:${first.line}:${first.message}`, kind: 'diagnostics',
            label: diagnosticsLabel(snapshot.diagnostics), title: list.map(d => `${d.path}:${d.line} ${d.message}`).join('\n'),
            text: `Problems reported by the editor (${snapshot.diagnostics.length}${list.length < snapshot.diagnostics.length ? `, first ${list.length}` : ''}):\n${list.map(formatDiagnostic).join('\n')}`
        });
    }
    if (snapshot.edits.length) {
        const paths = snapshot.edits.map(e => e.path);
        items.push({
            key: `edits:${paths.join(',')}`, kind: 'edits', label: `Recent edits · ${paths.length}`, title: paths.join('\n'),
            text: `Files the user edited recently (newest first):\n${snapshot.edits.map(e => `- ${e.path}${e.lines.length ? ` (lines ${e.lines.join(', ')})` : ''}`).join('\n')}`
        });
    }
    if (snapshot.diff.trim()) {
        const stat = diffStat(snapshot.diff);
        items.push({
            key: `diff:${stat.files}:${stat.added}:${stat.removed}`, kind: 'diff', label: `Git diff +${stat.added} −${stat.removed}`,
            title: `Uncommitted changes in ${plural(stat.files, 'file')}`,
            text: `Uncommitted changes (git diff HEAD, ${plural(stat.files, 'file')}, +${stat.added} −${stat.removed}):\n${fence(clipText(snapshot.diff, MAX_DIFF_CHARS), 'diff')}`
        });
    }
    if (snapshot.memories > 0) {
        items.push({
            key: `memory:${snapshot.memories}`, kind: 'memory', label: `${snapshot.memories} ${snapshot.memories === 1 ? 'memory' : 'memories'}`,
            title: 'Repo facts and preferences from earlier chats (click to manage)', text: ''
        });
    }
    return items.sort((a, b) => AUTO_CONTEXT_ORDER.indexOf(a.kind) - AUTO_CONTEXT_ORDER.indexOf(b.kind));
};

export const visibleAutoContext = (items: readonly AutoContextItem[], dismissed: ReadonlySet<string>): AutoContextItem[] =>
    items.filter(item => !dismissed.has(item.key));

/** The system-prompt section for the chips that are still attached. */
export const formatAutoContext = (items: readonly AutoContextItem[]): string => {
    const texts = items.map(item => item.text).filter(Boolean);
    return texts.length ? [AUTO_CONTEXT_HEADER, ...texts].join('\n\n') : '';
};

export const sentAutoContext = (items: readonly AutoContextItem[]): SentAutoContext[] => items.map(({ kind, label }) => ({ kind, label }));

/** Drops dismissals whose context is gone, so the set does not grow forever. */
export const pruneDismissed = (dismissed: ReadonlySet<string>, items: readonly AutoContextItem[]): Set<string> => {
    const keys = new Set(items.map(item => item.key));
    return new Set([...dismissed].filter(key => keys.has(key)));
};
