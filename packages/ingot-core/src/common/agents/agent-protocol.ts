/**
 * Provider-neutral agent protocol (IDEA-27/28): the model answers in plain text and proposes file edits as
 * whole-file blocks, which Ingot shows in the inline review. Works with every provider, no native tool calling needed.
 */
export const EDIT_OPEN = '<<<EDIT ';
export const EDIT_CLOSE = '>>>END';
export const TOOL_OPEN = '<<<TOOL ';

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

export interface AgentToolCall {
    readonly server: string;
    readonly tool: string;
    readonly args: Record<string, unknown>;
}

/** Describes the MCP tools the agent may call with `<<<TOOL server/tool` blocks. */
export const toolProtocol = (tools: readonly { server: string; name: string; description?: string; inputSchema?: unknown }[]): string =>
    tools.length ? [
        'You can call these tools. To call one, output a block and STOP; the result comes back in the next message:',
        `${TOOL_OPEN}server/tool`,
        '{"json": "arguments"}',
        EDIT_CLOSE,
        'Tools:',
        ...tools.map(t => `- ${t.server}/${t.name}: ${t.description ?? ''}${t.inputSchema ? ` Input schema: ${JSON.stringify(t.inputSchema)}` : ''}`)
    ].join('\n') : '';

export interface ParsedAgentOutput {
    /** Text to show in the conversation (edit blocks and plan removed). */
    readonly display: string;
    readonly plan: readonly string[];
    readonly edits: readonly AgentEdit[];
    readonly toolCalls: readonly AgentToolCall[];
    /** Path of an edit block that is still streaming. */
    readonly editing?: string;
    /** File content typed so far for the streaming edit (IDEA-102 live editor view). */
    readonly editingContent?: string;
}

const INVOKE_RE = /<(?:antml:)?invoke\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?invoke>/g;
const PARAM_RE = /<(?:antml:)?parameter\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?parameter>/g;
const CALLS_TAG_RE = /<\/?(?:antml:)?function_calls>/g;
const PARTIAL_CALL_RE = /<(?:antml:)?(?:function_calls|invoke)\b[\s\S]*$/;

const paramValue = (raw: string): unknown => {
    const value = raw.trim();
    if (/^(?:-?\d+(?:\.\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(value)) {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
};

/**
 * IDEA-250: some models answer with their native XML tool-call format (`<function_calls><invoke name="ingot/read_file">
 * <parameter name="path">…</parameter></invoke>`) instead of `<<<TOOL` blocks. Turn those into TOOL blocks so they run
 * instead of being printed; a call that is still streaming is hidden. A name without a server means an `ingot/` tool.
 */
export const normalizeToolCalls = (text: string): string => {
    if (!/<(?:antml:)?(?:invoke|function_calls)\b/.test(text)) {
        return text;
    }
    const converted = text.replace(INVOKE_RE, (_all, name: string, body: string) => {
        const args: Record<string, unknown> = {};
        for (const m of body.matchAll(PARAM_RE)) {
            args[m[1]] = paramValue(m[2]);
        }
        const target = name.includes('/') ? name : `ingot/${name}`;
        return `\n${TOOL_OPEN}${target}\n${JSON.stringify(args)}\n${EDIT_CLOSE}\n`;
    }).replace(CALLS_TAG_RE, '');
    return converted.replace(PARTIAL_CALL_RE, '');
};

/** Parses (possibly partial, streaming) agent output. */
export const parseAgentOutput = (raw: string): ParsedAgentOutput => {
    const text = normalizeToolCalls(raw);
    const edits: AgentEdit[] = [];
    const toolCalls: AgentToolCall[] = [];
    let display = '';
    let editing: string | undefined;
    let editingContent: string | undefined;
    let rest = text;
    for (;;) {
        const editAt = rest.indexOf(EDIT_OPEN);
        const toolAt = rest.indexOf(TOOL_OPEN);
        const isTool = toolAt >= 0 && (editAt < 0 || toolAt < editAt);
        const start = isTool ? toolAt : editAt;
        if (start < 0) {
            display += rest;
            break;
        }
        display += rest.slice(0, start);
        const afterOpen = rest.slice(start + (isTool ? TOOL_OPEN : EDIT_OPEN).length);
        const lineEnd = afterOpen.indexOf('\n');
        if (lineEnd < 0) {
            editing = isTool ? undefined : afterOpen.trim() || undefined;
            break;
        }
        const target = afterOpen.slice(0, lineEnd).trim();
        const body = afterOpen.slice(lineEnd + 1);
        const end = body.indexOf(EDIT_CLOSE);
        if (end < 0) {
            editing = isTool ? undefined : target;
            editingContent = isTool ? undefined : body;
            break;
        }
        const content = body.slice(0, end);
        if (isTool) {
            const [server, ...toolParts] = target.split('/');
            let args: Record<string, unknown> = {};
            try {
                const parsed = JSON.parse(content.trim() || '{}');
                args = parsed && typeof parsed === 'object' ? parsed : {};
            } catch {
                args = {};
            }
            toolCalls.push({ server, tool: toolParts.join('/'), args });
        } else {
            edits.push({ path: target, content: content.replace(/\n$/, '') + '\n' });
        }
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
    return { display: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), plan, edits, toolCalls, editing, editingContent };
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
