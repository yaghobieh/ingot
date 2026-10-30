import type { ChatMessage } from '../models/models.types';
import { TAB_CURSOR, TAB_MIN_NEXT_SNIPPET, TAB_NEXT_MARKER, TAB_RECENT_EDIT_MAX_CHARS, TAB_SYSTEM_PROMPT } from './tab.consts';
import type { TabContext, TabPrediction, TabRecentEdit } from './tab.types';

const FENCE_START = /^```[\w-]*\n?/;
const FENCE_END = /\n?```\s*$/;
const TRAILING_NEWLINES = /\n+$/;

/** Fill-in-the-middle prompt: file, recent edits, then the code around the cursor with a cursor marker. */
export const buildTabMessages = (context: TabContext): ChatMessage[] => {
    const edits = context.recentEdits.length
        ? `Recent edits (oldest first):\n${context.recentEdits.map(e => `- line ${e.line}: ${e.text}`).join('\n')}\n\n`
        : '';
    return [
        { role: 'system', content: TAB_SYSTEM_PROMPT },
        { role: 'user', content: `Language: ${context.language}\nFile: ${context.path}\n\n${edits}${context.prefix}${TAB_CURSOR}${context.suffix}` }
    ];
};

/**
 * Turns a model reply into ghost text plus an optional next-edit snippet. Drops fences and cursor markers,
 * the current line's text when the model repeats it, and the rest of the line when the model repeats that.
 */
export const parseTabReply = (reply: string, linePrefix: string, lineSuffix: string): TabPrediction => {
    const lines = reply.replace(FENCE_START, '').replace(FENCE_END, '').split('\n');
    const markerAt = lines.findIndex(line => line.trimStart().startsWith(TAB_NEXT_MARKER));
    const nextSnippet = markerAt < 0 ? '' : lines[markerAt].trimStart().slice(TAB_NEXT_MARKER.length).trim();
    let insertText = (markerAt < 0 ? lines : lines.slice(0, markerAt)).join('\n').split(TAB_CURSOR).join('');
    if (markerAt >= 0) {
        insertText = insertText.replace(TRAILING_NEWLINES, '');
    }
    if (linePrefix.trim() && insertText.startsWith(linePrefix)) {
        insertText = insertText.slice(linePrefix.length);
    }
    const tail = lineSuffix.trim();
    if (tail && insertText.trimEnd().endsWith(tail)) {
        insertText = insertText.trimEnd().slice(0, -tail.length);
    }
    return {
        insertText: insertText.trim() ? insertText : '',
        ...(nextSnippet.length >= TAB_MIN_NEXT_SNIPPET ? { nextSnippet } : {})
    };
};

/** 1-based line holding the snippet: the first one below the cursor, else the closest one above. */
export const findNextEditLine = (lines: readonly string[], snippet: string, cursorLine: number): number | undefined => {
    const needle = snippet.trim();
    if (needle.length < TAB_MIN_NEXT_SNIPPET) {
        return undefined;
    }
    const matches = lines.map((line, i) => (line.includes(needle) ? i + 1 : 0)).filter(n => n > 0 && n !== cursorLine);
    return matches.find(n => n > cursorLine) ?? matches.at(-1);
};

/** Keeps the latest `max` edited lines, one entry per line, newest last. */
export const recordRecentEdit = (edits: readonly TabRecentEdit[], edit: TabRecentEdit, max: number): TabRecentEdit[] => {
    const rest = edits.filter(e => e.line !== edit.line);
    const text = edit.text.trim().slice(0, TAB_RECENT_EDIT_MAX_CHARS);
    return (text ? [...rest, { line: edit.line, text }] : rest).slice(-max);
};
