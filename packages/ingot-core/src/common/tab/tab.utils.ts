import type { ChatMessage } from '../models/models.types';
import {
    TAB_CURSOR, TAB_MAX_OVERLAP, TAB_MIN_NEXT_SNIPPET, TAB_MIN_WORD_OVERLAP, TAB_NEXT_MARKER, TAB_RECENT_EDIT_MAX_CHARS, TAB_SYSTEM_PROMPT
} from './tab.consts';
import type { TabContext, TabPrediction, TabRecentEdit } from './tab.types';

const FENCE_START = /^```[\w-]*\n?/;
const FENCE_END = /\n?```\s*$/;
const TRAILING_NEWLINES = /\n+$/;
const OPENERS = /^[([{'"`]+$/;
const WORD = /^\w+$/;
const WORD_CHAR = /\w/;

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

/** True when every character of `needle` appears in `text` in order. */
export const isSubsequence = (needle: string, text: string): boolean => {
    let at = 0;
    for (const c of text) {
        if (at < needle.length && c === needle[at]) {
            at++;
        }
    }
    return at === needle.length;
};

/**
 * Drops the start of a reply that repeats the end of the line before the cursor: opening brackets or quotes
 * (often auto-closed already) or a whole identifier the user is typing (`sub` + `subtract` → `tract`).
 */
export const trimPrefixOverlap = (text: string, linePrefix: string): string => {
    for (let k = Math.min(text.length, linePrefix.length, TAB_MAX_OVERLAP); k > 0; k--) {
        const head = text.slice(0, k);
        if (!linePrefix.endsWith(head)) {
            continue;
        }
        const before = linePrefix.charAt(linePrefix.length - k - 1);
        const wholeWord = k >= TAB_MIN_WORD_OVERLAP && WORD.test(head) && !WORD_CHAR.test(before);
        if (wholeWord || OPENERS.test(head)) {
            return text.slice(k);
        }
    }
    return text;
};

/**
 * Turns a model reply into ghost text plus an optional next-edit snippet. Drops fences, cursor markers and text the
 * line already has before the cursor. When the cursor sits before text (an auto-closed `)`), the prediction replaces
 * the rest of the line and keeps that text, so Monaco shows the ghost text around it instead of leaving it dangling.
 */
export const parseTabReply = (reply: string, linePrefix: string, lineSuffix: string): TabPrediction => {
    const lines = reply.replace(FENCE_START, '').replace(FENCE_END, '').split('\n');
    const markerAt = lines.findIndex(line => line.trimStart().startsWith(TAB_NEXT_MARKER));
    const nextSnippet = markerAt < 0 ? '' : lines[markerAt].trimStart().slice(TAB_NEXT_MARKER.length).trim();
    let insertText = (markerAt < 0 ? lines : lines.slice(0, markerAt)).join('\n').split(TAB_CURSOR).join('');
    if (markerAt >= 0) {
        insertText = insertText.replace(TRAILING_NEWLINES, '');
    }
    const typed = linePrefix.trimStart();
    insertText = typed && insertText.startsWith(typed) ? insertText.slice(typed.length) : trimPrefixOverlap(insertText, linePrefix);
    const replacesSuffix = !!insertText.trim() && !!lineSuffix.trim();
    if (replacesSuffix && !isSubsequence(lineSuffix, insertText)) {
        insertText += lineSuffix;
    }
    return {
        insertText: insertText.trim() ? insertText : '',
        replacesSuffix,
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
