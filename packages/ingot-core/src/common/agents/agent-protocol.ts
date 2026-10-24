/**
 * Provider-neutral agent protocol (IDEA-27/28): the model answers in plain text and proposes file edits as
 * whole-file blocks, which Ingot shows in the inline review. Works with every provider, no native tool calling needed.
 */
export const EDIT_OPEN = '<<<EDIT ';
export const EDIT_CLOSE = '>>>END';

export const AGENT_PROTOCOL = [
    'You can change files in the user\'s project. To change a file, output the COMPLETE new file content in a block:',
    `${EDIT_OPEN}relative/path/to/file.ext`,
    '<entire new file content>',
    EDIT_CLOSE,
    'Rules: one block per file; paths are relative to the project root; never use ".." or absolute paths;',
    'keep everything you do not intend to change; outside blocks, explain briefly what you changed.',
    'Optionally start with a short plan:',
    'PLAN:',
    '- step one',
    '- step two'
].join('\n');

export interface AgentEdit {
    readonly path: string;
    readonly content: string;
}

export interface ParsedAgentOutput {
    /** Text to show in the conversation (edit blocks and plan removed). */
    readonly display: string;
    readonly plan: readonly string[];
    readonly edits: readonly AgentEdit[];
    /** Path of an edit block that is still streaming. */
    readonly editing?: string;
}

/** Parses (possibly partial, streaming) agent output. */
export const parseAgentOutput = (text: string): ParsedAgentOutput => {
    const edits: AgentEdit[] = [];
    let display = '';
    let editing: string | undefined;
    let rest = text;
    for (;;) {
        const start = rest.indexOf(EDIT_OPEN);
        if (start < 0) {
            display += rest;
            break;
        }
        display += rest.slice(0, start);
        const afterOpen = rest.slice(start + EDIT_OPEN.length);
        const lineEnd = afterOpen.indexOf('\n');
        if (lineEnd < 0) {
            editing = afterOpen.trim() || undefined;
            break;
        }
        const path = afterOpen.slice(0, lineEnd).trim();
        const body = afterOpen.slice(lineEnd + 1);
        const end = body.indexOf(EDIT_CLOSE);
        if (end < 0) {
            editing = path;
            break;
        }
        edits.push({ path, content: body.slice(0, end).replace(/\n$/, '') + '\n' });
        rest = body.slice(end + EDIT_CLOSE.length);
    }
    const plan: string[] = [];
    const lines = display.split('\n');
    const planAt = lines.findIndex(l => /^\s*PLAN:\s*$/i.test(l));
    if (planAt >= 0) {
        let i = planAt + 1;
        while (i < lines.length && /^\s*(?:[-*]|\d+[.)])\s+/.test(lines[i])) {
            plan.push(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim());
            i++;
        }
        lines.splice(planAt, i - planAt);
    }
    return { display: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), plan, edits, editing };
};

/** `@path/to/file` mentions in a prompt. */
export const parseMentions = (prompt: string): string[] =>
    [...new Set([...prompt.matchAll(/(?:^|\s)@([\w./-]+\.[\w]+)/g)].map(m => m[1]))];

export const MAX_CONTEXT_CHARS = 24_000;

/** Formats files for the prompt, truncating very large ones. */
export const formatContextFiles = (files: readonly { path: string; content: string }[], budget = MAX_CONTEXT_CHARS): string => {
    let left = budget;
    const parts: string[] = [];
    for (const file of files) {
        if (left <= 0) {
            break;
        }
        const content = file.content.length > left ? `${file.content.slice(0, left)}\n… (truncated)` : file.content;
        left -= content.length;
        parts.push(`File: ${file.path}\n\`\`\`\n${content}\n\`\`\``);
    }
    return parts.join('\n\n');
};
