import type { ChatMessage } from '../models/models.types';
import { INLINE_EDIT_SYSTEM_PROMPT } from './inline-edit.consts';
import type { InlineEditRequest, LineSpan } from './inline-edit.types';

const FENCE = /^\s*(```|~~~)/;
const CRLF = '\r\n';
const LF = '\n';

const eolOf = (text: string): string => text.includes(CRLF) ? CRLF : LF;
const linesOf = (text: string): string[] => text.split(/\r?\n/);

/** Whole lines covered by a selection; a selection ending at column 1 does not take that last line. */
export const selectionLineSpan = (selection: { startLineNumber: number; endLineNumber: number; endColumn: number }): LineSpan => ({
    startLine: selection.startLineNumber,
    endLine: selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber
});

/** The selected lines plus up to `context` lines on each side. */
export const splitAroundSpan = (text: string, span: LineSpan, context: number): { before: string; selection: string; after: string } => {
    const lines = linesOf(text);
    const start = span.startLine - 1;
    return {
        before: lines.slice(Math.max(0, start - context), start).join(LF),
        selection: lines.slice(start, span.endLine).join(LF),
        after: lines.slice(span.endLine, span.endLine + context).join(LF)
    };
};

/** The file with the span's lines swapped for `replacement`, keeping the file's line endings. */
export const replaceSpan = (text: string, span: LineSpan, replacement: string): string => {
    const lines = linesOf(text);
    return [...lines.slice(0, span.startLine - 1), ...linesOf(replacement), ...lines.slice(span.endLine)].join(eolOf(text));
};

/** The code from a model reply: Markdown fences and blank lines around it removed, indentation kept. */
export const cleanReply = (reply: string): string => {
    let lines = linesOf(reply);
    const first = lines.findIndex(l => l.trim());
    if (first >= 0 && FENCE.test(lines[first])) {
        const close = lines.findIndex((l, i) => i > first && FENCE.test(l));
        lines = lines.slice(first + 1, close > first ? close : undefined);
    }
    while (lines.length && !lines[0].trim()) {
        lines.shift();
    }
    while (lines.length && !lines[lines.length - 1].trim()) {
        lines.pop();
    }
    return lines.join(LF);
};

export const buildInlineEditMessages = (request: InlineEditRequest): ChatMessage[] => [
    { role: 'system', content: INLINE_EDIT_SYSTEM_PROMPT },
    {
        role: 'user',
        content: [
            `FILE: ${request.path} (${request.languageId})`,
            `INSTRUCTION: ${request.instruction}`,
            'CODE BEFORE THE SELECTION:',
            request.before,
            '<<<SELECTED CODE',
            request.selection,
            'SELECTED CODE>>>',
            'CODE AFTER THE SELECTION:',
            request.after
        ].join(LF)
    }
];
