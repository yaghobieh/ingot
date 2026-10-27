/**
 * IDEA-177: rich agent-chat tool cards. Pure helpers that turn a tool call and its result into what the chat shows:
 * a terminal block (title, highlighted command, exit status, output), a profile card (GitHub-style user results),
 * or a compact generic card. Also the "Explored N files, M searches" and "Thought" rows.
 */

export type ToolRunState = 'running' | 'done' | 'error';

/** Kept on a `tool` chat message so the card can be drawn (and re-drawn from history). */
export interface ToolCallInfo {
    readonly server: string;
    readonly tool: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly state: ToolRunState;
    readonly startedAt: number;
    readonly endedAt?: number;
}

export interface ProfileCard {
    readonly login: string;
    readonly name?: string;
    readonly avatarUrl?: string;
    readonly location?: string;
    readonly website?: string;
    readonly email?: string;
    readonly bio?: string;
    readonly repos?: number;
    readonly followers?: number;
    readonly following?: number;
    readonly url?: string;
}

export interface TerminalCard {
    readonly kind: 'terminal';
    readonly title: string;
    readonly command: string;
    /** Distinct program names in the command, e.g. "echo, git, npm". */
    readonly programs: readonly string[];
    readonly output: string;
    readonly exitCode?: number;
    /** Background / moved-to-background / stopped note, when there is one. */
    readonly note?: string;
}

export type ToolCard =
    | TerminalCard
    | { readonly kind: 'profile'; readonly title: string; readonly profile: ProfileCard }
    | { readonly kind: 'generic'; readonly title: string; readonly detail: string; readonly output: string };

export const TOOL_OUTPUT_PREVIEW_LINES = 12;
const MAX_TITLE = 64;

const str = (v: unknown): string => typeof v === 'string' ? v : '';
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export const shorten = (text: string, max = MAX_TITLE): string => {
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** Program names a shell command runs: the first word of each pipeline / list segment, skipping env assignments. */
export const commandPrograms = (command: string): string[] => {
    const seen: string[] = [];
    const keywords = new Set(['for', 'in', 'do', 'done', 'if', 'then', 'else', 'fi', 'while', 'case', 'esac', 'export', 'sudo', 'time', 'env', 'exec', '{', '}', '(', ')', '!']);
    const stripped = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' ').replace(/\d*[<>]&\d*|&>/g, ' ');
    for (const segment of stripped.split(/\n|&&|\|\||[|;&]/)) {
        const words = segment.trim().split(/\s+/).filter(Boolean);
        let i = 0;
        while (i < words.length && (keywords.has(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) {
            // `for d in a b; do` — skip the loop variable and its list.
            if (words[i] === 'for' || words[i] === 'in' || words[i] === 'case') { i = words.length; break; }
            i++;
        }
        const word = words[i];
        if (word && /^[A-Za-z0-9._/@+-]+$/.test(word) && !/^-/.test(word)) {
            const name = word.split('/').pop()!;
            if (name && !seen.includes(name)) {
                seen.push(name);
            }
        }
    }
    return seen;
};

/** Splits the run tool's text into output, exit code and a status note (see AgentStore.runCommand). */
export const parseRunResult = (text: string): { output: string; exitCode?: number; note?: string } => {
    let body = text.replace(/^Error: /, '');
    const exit = /\n?Exit(?:ed with)? code (-?\d+|\?)\.?\s*$/.exec(body);
    if (exit) {
        body = body.slice(0, exit.index);
        return { output: body.trimEnd(), exitCode: exit[1] === '?' ? undefined : Number(exit[1]) };
    }
    const note = /\n?(Still running after [^\n]*|Stopped\.|Running in the background as [^\n]*)\s*$/.exec(body)
        ?? /^(Running in the background as [^\n]*)\n?/.exec(body);
    if (note) {
        return { output: body.replace(note[0], '').trimEnd(), note: note[1] };
    }
    return { output: body.trimEnd() };
};

/** Finds the first JSON object in a tool result (MCP servers often wrap it in text). */
export const firstJsonObject = (text: string): Record<string, unknown> | undefined => {
    const start = text.indexOf('{');
    if (start < 0) {
        return undefined;
    }
    for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
        try {
            const value: unknown = JSON.parse(text.slice(start, end + 1));
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return value as Record<string, unknown>;
            }
        } catch {
            // try a shorter span
        }
    }
    return undefined;
};

/** A user profile result (`login` plus profile fields), e.g. GitHub's get_me / get_user. */
export const parseProfile = (text: string): ProfileCard | undefined => {
    const raw = firstJsonObject(text);
    const obj = raw && typeof raw.user === 'object' && raw.user ? raw.user as Record<string, unknown> : raw;
    const login = str(obj?.login);
    if (!obj || !login || !(obj.avatar_url || obj.name || obj.public_repos !== undefined || obj.followers !== undefined)) {
        return undefined;
    }
    const details = typeof obj.details === 'object' && obj.details ? obj.details as Record<string, unknown> : {};
    const pick = (key: string): unknown => obj[key] ?? details[key];
    const blog = str(pick('blog'));
    return {
        login,
        name: str(pick('name')) || undefined,
        avatarUrl: str(obj.avatar_url) || undefined,
        location: str(pick('location')) || undefined,
        website: blog ? (/^https?:\/\//i.test(blog) ? blog : `https://${blog}`) : undefined,
        email: str(pick('email')) || undefined,
        bio: str(pick('bio')) || undefined,
        repos: num(pick('public_repos')),
        followers: num(pick('followers')),
        following: num(pick('following')),
        url: str(obj.html_url ?? obj.profile_url) || undefined
    };
};

const TOOL_TITLES: Record<string, string> = {
    git: 'Git', web_search: 'Searched the web', web_fetch: 'Fetched', delete: 'Deleted', scripts: 'Listed scripts',
    processes: 'Listed processes', process_output: 'Read process output', process_stop: 'Stopped process'
};

/** What card a finished (or running) tool message gets. */
export const toolCard = (info: ToolCallInfo, text: string, builtinServer = 'ingot'): ToolCard => {
    const builtin = info.server === builtinServer;
    if (builtin && info.tool === 'run') {
        const command = str(info.args.command).trim();
        const description = str(info.args.description) || str(info.args.title);
        const parsed = info.state === 'running' ? { output: text } : parseRunResult(text);
        const programs = commandPrograms(command);
        return {
            kind: 'terminal', command, programs, ...parsed,
            title: shorten(description || command.split('\n')[0] || 'Run command')
        };
    }
    const profile = info.state === 'running' ? undefined : parseProfile(text);
    if (profile) {
        return { kind: 'profile', title: `Ran ${info.tool}`, profile };
    }
    const firstArg = Object.values(info.args).find(v => typeof v === 'string' && v.trim()) as string | undefined;
    const title = builtin ? (TOOL_TITLES[info.tool] ?? info.tool) : `Ran ${info.tool}`;
    const detail = builtin && info.tool === 'git' ? shorten([str(info.args.op), str(info.args.branch) || str(info.args.message)].filter(Boolean).join(' '), 48)
        : firstArg ? shorten(firstArg, 48) : '';
    return { kind: 'generic', title, detail, output: text.replace(/^Error: /, '') };
};

/** "Explored 3 files, 2 searches" from the run's read / search steps (past tense once the run is over). */
export const exploredLine = (steps: readonly { kind: string; target: string }[], running: boolean): string | undefined => {
    const files = new Set<string>();
    const folders = new Set<string>();
    let searches = 0;
    for (const step of steps) {
        if (step.kind === 'read' && !step.target.startsWith('rules:')) {
            // IDEA-186: a target ending in "/" is a listed folder.
            step.target.split(',').map(s => s.trim()).filter(Boolean).forEach(f => (f.endsWith('/') ? folders : files).add(f));
        } else if (step.kind === 'search' || (step.kind === 'run' && /\/(?:web_search|search|search_code|grep)/.test(step.target))) {
            searches++;
        }
    }
    const parts = [
        files.size ? `${files.size} ${files.size === 1 ? 'file' : 'files'}` : '',
        folders.size ? `${folders.size} ${folders.size === 1 ? 'folder' : 'folders'}` : '',
        searches ? `${searches} ${searches === 1 ? 'search' : 'searches'}` : ''
    ].filter(Boolean);
    return parts.length ? `${running ? 'Exploring' : 'Explored'} ${parts.join(', ')}` : undefined;
};

/** Pulls `<think>…</think>` (or `<thinking>`) reasoning out of a reply; an unclosed block means still thinking. */
export const extractThought = (text: string): { thought?: string; rest: string; thinking: boolean } => {
    const open = /<(think|thinking)>/i.exec(text);
    if (!open) {
        return { rest: text, thinking: false };
    }
    const tag = open[1];
    const close = new RegExp(`</${tag}>`, 'i').exec(text.slice(open.index));
    if (!close) {
        return { thought: text.slice(open.index + open[0].length).trim(), rest: text.slice(0, open.index).trim(), thinking: true };
    }
    const end = open.index + close.index + close[0].length;
    return {
        thought: text.slice(open.index + open[0].length, open.index + close.index).trim(),
        rest: `${text.slice(0, open.index)}${text.slice(end)}`.trim(),
        thinking: false
    };
};

export const durationLabel = (ms: number): string => ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;

export type ShellTokenKind = 'cmd' | 'flag' | 'str' | 'var' | 'op' | 'comment' | 'text' | 'prompt';
export interface ShellToken { readonly text: string; readonly kind: ShellTokenKind }

/** Small shell highlighter for the command in a terminal card. */
export const highlightShell = (command: string): ShellToken[] => {
    const tokens: ShellToken[] = [];
    const re = /(#[^\n]*)|('[^']*'?|"(?:[^"\\]|\\.)*"?)|(\$\{[^}]*\}?|\$[A-Za-z_][A-Za-z0-9_]*|\$\(|\$\?)|(&&|\|\||[|;&<>()]|\n)|(\s+)|(--?[A-Za-z0-9][\w-]*(?:=[^\s;|&]*)?)|([^\s'"$|;&<>()#]+)/g;
    let expectCmd = true;
    let m: RegExpExecArray | null;
    while ((m = re.exec(command))) {
        const [text, comment, quoted, variable, op, space, flag] = m;
        if (comment) { tokens.push({ text, kind: 'comment' }); continue; }
        if (quoted) { tokens.push({ text, kind: 'str' }); expectCmd = false; continue; }
        if (variable) { tokens.push({ text, kind: 'var' }); if (text === '$(') { expectCmd = true; } continue; }
        if (op) { tokens.push({ text, kind: op === '\n' ? 'text' : 'op' }); expectCmd = op !== '>' && op !== '<' && op !== ')'; continue; }
        if (space) { tokens.push({ text, kind: 'text' }); continue; }
        if (flag) { tokens.push({ text, kind: 'flag' }); continue; }
        const word = text;
        if (expectCmd && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
            tokens.push({ text: word, kind: 'cmd' });
            expectCmd = ['sudo', 'time', 'env', 'exec', 'do', 'then', 'else', '!', 'export'].includes(word);
            if (word === 'export') { expectCmd = false; }
        } else {
            tokens.push({ text: word, kind: 'text' });
            if (['do', 'then', 'else'].includes(word)) { expectCmd = true; }
        }
    }
    // Merge neighbours of the same kind so the DOM stays small.
    return tokens.reduce<ShellToken[]>((out, t) => {
        const last = out[out.length - 1];
        if (last && last.kind === t.kind && t.kind !== 'cmd') {
            out[out.length - 1] = { text: last.text + t.text, kind: t.kind };
        } else {
            out.push(t);
        }
        return out;
    }, []);
};
