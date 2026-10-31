/**
 * IDEA-186: local-first code reading. Read-only workspace tools (read_file, list_dir, grep) that run at once, the
 * system-prompt section that tells the agent to use them before any remote (GitHub) tool, and the GitHub owner/repo
 * taken from the workspace's git remote (never guessed, never empty).
 */
import type { AgentToolCall } from './agent-protocol';
import { BUILTIN_TOOL_SERVER } from './agent-actions';
import { isLibraryPrompt } from './library-app';
import { isActionRequest } from './task-intent';
import { INDEX_DIR } from '../codebase-index/codebase-index.consts';

export const WORKSPACE_TOOLS = [
    { name: 'list_dir', description: 'List a folder of the open project. Arguments: {"path"?: "src", "depth"?: 1..3}. Skips .gitignore and dependency folders. Runs at once.' },
    { name: 'read_file', description: 'Read a file of the open project with line numbers. Arguments: {"path": "package.json", "start"?: 1, "end"?: 200}. Runs at once.' },
    { name: 'glob', description: 'Find files by name in the open project. Arguments: {"pattern": "**/*.test.ts", "path"?: "src"}. Respects .gitignore. Runs at once.' },
    { name: 'grep', description: 'Search the open project\'s files for text or a regex (ripgrep). Arguments: {"pattern": "useCart", "path"?: "src", "glob"?: "*.ts", "regex"?: false}. Respects .gitignore. Runs at once.' },
    { name: 'codebase_search', description: 'Find code by meaning in the open project\'s local index (IDEA-260). Arguments: {"query": "where are prices rounded", "path"?: "src", "limit"?: 1..20}. Returns ranked snippets with path and line range; open more with read_file. Runs at once.' }
] as const;
export type WorkspaceToolName = typeof WORKSPACE_TOOLS[number]['name'];
export const WORKSPACE_TOOL_NAMES: readonly string[] = WORKSPACE_TOOLS.map(t => t.name);
export const isWorkspaceTool = (name: string): name is WorkspaceToolName => WORKSPACE_TOOL_NAMES.includes(name);

export const READ_MAX_LINES = 400;
export const READ_MAX_CHARS = 40_000;
export const LIST_MAX_ENTRIES = 300;
export const GREP_MAX_MATCHES = 150;
export const GREP_MAX_FILES = 4000;
export const GREP_MAX_FILE_BYTES = 512 * 1024;
/** Folders the tools skip (dependencies, build output, VCS). */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'build', 'out', '.next', '.turbo', 'coverage', '.cache', '.venv', '__pycache__', 'target', 'obj', '.dart_tool', '.gradle']);
/** IDEA-313: compiled output of the other languages (class files, jars, object files, bytecode) is never text. */
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|mov|wasm|exe|dll|so|dylib|bin|lock|class|jar|war|ear|pyc|pyo|o|a|obj|lib|pdb|rlib|rmeta|nupkg|dill|swiftmodule)$/i;
export const isTextCandidate = (path: string): boolean => !BINARY.test(path);

export interface GitHubRepo { readonly owner: string; readonly repo: string }

/** owner/repo from a GitHub remote URL (https, ssh, scp-like); undefined for other hosts. */
export const githubRepoFromRemote = (url: string | undefined): GitHubRepo | undefined => {
    const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec((url ?? '').trim());
    return m && m[1] && m[2] ? { owner: m[1], repo: m[2] } : undefined;
};

export interface WorkspaceInfo {
    readonly name?: string;
    readonly branch?: string;
    /** Absolute path of the open folder. It is the source of truth for project questions. */
    readonly path?: string;
    readonly github?: GitHubRepo;
}

/** The system-prompt section: local tools first, GitHub only for remote questions, run commands instead of printing them. */
export const workspaceProtocol = (info: WorkspaceInfo): string => [
    'Project tools (same block format, server "ingot"; read-only, they run at once):',
    ...WORKSPACE_TOOLS.map(t => `- ingot/${t.name}: ${t.description}`),
    `The open project${info.name ? ` is "${info.name}"` : ''}${info.branch ? ` on branch ${info.branch}` : ''}.`,
    info.path
        ? `The open workspace path is ${info.path}. That folder is the source of truth for this project's code.`
        : 'The open workspace folder is the source of truth for this project\'s code.',
    'For ANY question about this project or its code ("what do you know about…", "how does … work", "learn the code"), explore it with',
    'ingot/list_dir, ingot/glob, ingot/grep and ingot/read_file FIRST, then answer from what you read. Do not answer from memory and do not use remote tools for it.',
    'For "where / how is X done" questions without an exact name, start with ingot/codebase_search: it returns the best snippets, which costs fewer tokens than reading whole files.',
    info.github
        ? `Use GitHub tools only when the user asks about the remote repository (pull requests, issues, other branches on GitHub). This project's repository is ${info.github.owner}/${info.github.repo} (owner "${info.github.owner}", repo "${info.github.repo}", from its git remote); use exactly those, never guess.`
        : 'This project has no GitHub remote: do not call GitHub tools for it.',
    'Never print shell commands (```bash blocks such as cat, ls, grep) for the user to run: read files with ingot/read_file, search with ingot/grep or ingot/glob, or call ingot/run yourself.'
].join('\n');

/** Fills empty `owner` / `repo` arguments of a GitHub tool call from the workspace remote (never leaves them empty). */
export const withRepoDefaults = (call: AgentToolCall, github: GitHubRepo | undefined): AgentToolCall => {
    if (!github || !/github/i.test(call.server) || !('owner' in call.args || 'repo' in call.args)) {
        return call;
    }
    const empty = (v: unknown): boolean => typeof v !== 'string' || !v.trim();
    if (!empty(call.args.owner) && !empty(call.args.repo)) {
        return call;
    }
    return { ...call, args: { ...call.args, owner: empty(call.args.owner) ? github.owner : call.args.owner, repo: empty(call.args.repo) ? github.repo : call.args.repo } };
};

/** Printed shell lines turned into tool calls, so a model that says `cat package.json` still reads the file. */
export const MAX_RECOVERED_COMMANDS = 4;
const SHELL_FENCE_RE = /```(?:bash|sh|shell|zsh|console)\s*\n([\s\S]*?)```/gi;
const SHELL_LINE_RE = /^\s*(?:\$\s*)?(cat|head|tail|ls|grep|rg|npm|pnpm|yarn|node|git)\b(.*)$/i;
const SHELL_PRINT_RE = /```(?:bash|sh|shell|zsh|console)\s*\n\s*\$?\s*(cat|ls|head|tail|grep|rg|find|tree|wc|less|more|npm|pnpm|yarn|git|node)\b/i;

const unquote = (token: string): string => token.replace(/^['"]|['"]$/g, '');

/** A project-relative path. Absolute paths and `..` are refused. */
const safeRel = (raw: string | undefined): string | undefined => {
    const value = unquote((raw ?? '').trim());
    if (!value || value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value) || value.split(/[\\/]/).includes('..')) {
        return undefined;
    }
    return value === '.' ? '' : value;
};

const recoverLine = (cmd: string, tokens: readonly string[], full: string): AgentToolCall | undefined => {
    const positional = tokens.filter(token => !token.startsWith('-'));
    if (cmd === 'cat' || cmd === 'head' || cmd === 'tail') {
        const path = safeRel(positional[positional.length - 1]);
        if (!path) {
            return undefined;
        }
        const flag = tokens.findIndex(token => token === '-n' || token === '--lines');
        const end = cmd === 'head' && flag >= 0 ? Number(tokens[flag + 1]) : undefined;
        return { server: BUILTIN_TOOL_SERVER, tool: 'read_file', args: { path, ...(end && Number.isFinite(end) ? { end } : {}) } };
    }
    if (cmd === 'ls') {
        const path = safeRel(positional[0] ?? '.');
        return path === undefined ? undefined : { server: BUILTIN_TOOL_SERVER, tool: 'list_dir', args: { path } };
    }
    if (cmd === 'grep' || cmd === 'rg') {
        const pattern = positional[0];
        if (!pattern) {
            return undefined;
        }
        const path = positional[1] ? safeRel(positional[1]) : '';
        if (positional[1] && path === undefined) {
            return undefined;
        }
        return { server: BUILTIN_TOOL_SERVER, tool: 'grep', args: { pattern: unquote(pattern), ...(path ? { path } : {}) } };
    }
    return { server: BUILTIN_TOOL_SERVER, tool: 'run', args: { command: full } };
};

/** Shell lines a model printed instead of calling a tool, capped so one reply cannot start a command storm. */
export const shellReadsAsTools = (reply: string): AgentToolCall[] => {
    const calls: AgentToolCall[] = [];
    const text = reply.replace(SHELL_FENCE_RE, '\n$1\n');
    for (const line of text.split('\n')) {
        if (calls.length >= MAX_RECOVERED_COMMANDS) {
            break;
        }
        const match = SHELL_LINE_RE.exec(line);
        if (!match) {
            continue;
        }
        const cmd = match[1].toLowerCase();
        const rest = match[2].trim();
        const call = recoverLine(cmd, rest.split(/\s+/).filter(Boolean), `${match[1]} ${rest}`.trim());
        if (call) {
            calls.push(call);
        }
    }
    return calls;
};

/** True when a reply with no tool calls hands the user shell commands to run. */
export const printsShellInsteadOfRunning = (reply: string): boolean => SHELL_PRINT_RE.test(reply) || shellReadsAsTools(reply).length > 0;

/** Editor text wins over a cached disk read. Undefined editor means use the disk bytes. */
export const textForRead = (disk: string | undefined, editor: string | undefined): string | undefined =>
    editor !== undefined ? editor : disk;

export const SHELL_NUDGE = 'You printed shell commands instead of running them. Do not ask the user to run anything: read files with ingot/read_file, list with ingot/list_dir, find files with ingot/glob, search with ingot/grep, or call ingot/run yourself, then answer.';

/** A question about the open project. An echoed copy of it is not an answer. */
export const PROJECT_QUESTION = /\b(learn|what do you know|from the code|explore (this|the)|read the (code|project|repo))\b/i;
const ECHO_MIN_CHARS = 8;
/** Files a project question is answered from when the model only repeats the question. */
export const PROJECT_ENTRY_FILES = ['README.md', 'AGENTS.md', 'package.json', 'CONTRIBUTING.md'] as const;
const PROJECT_INTRO_LINES = 4;
const SCRIPT_PREVIEW = ['start', 'gate', 'test', 'build', 'e2e'] as const;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** True when the reply is the question repeated, including a gateway "Echo:" line. */
export const isPromptEcho = (reply: string, prompt: string): boolean => {
    const asked = oneLine(prompt);
    if (asked.length < ECHO_MIN_CHARS) {
        return false;
    }
    const stripped = oneLine(reply).replace(/^#+\s*gateway reply\s*/i, '').replace(/^echo:\s*/i, '').trim();
    return stripped === asked;
};

const QUESTION_START = /^(what|who|how|why|where|when|which|tell me|explain|describe|can you|could you|do you)\b/i;
const LEADING_FILLER = /^(?:but|and|so|ok|okay|well|now|then|also|please)\b[,:]?\s*/i;
const PROJECT_TOKEN = /^(codebase|repository|repo|folder|code|app|ingot)$/i;
const PROJECT_SPELLING = 'project';
const PROJECT_TYPO_DISTANCE = 2;
const PROJECT_WORD_MIN_CHARS = 6;
const PROJECT_WORD_MAX_CHARS = 9;

const editDistance = (left: string, right: string): number => {
    const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
    const next = Array.from({ length: right.length + 1 }, () => 0);
    for (let i = 1; i <= left.length; i++) {
        next[0] = i;
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j < next.length; j++) {
            prev[j] = next[j];
        }
    }
    return prev[right.length];
};

const isProjectToken = (raw: string): boolean => {
    const word = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (PROJECT_TOKEN.test(word)) {
        return true;
    }
    if (word.length < PROJECT_WORD_MIN_CHARS || word.length > PROJECT_WORD_MAX_CHARS) {
        return false;
    }
    return editDistance(word, PROJECT_SPELLING) <= PROJECT_TYPO_DISTANCE;
};

/**
 * True when an echoed reply should be replaced by a read of the open folder.
 * A follow-up such as "but what is the idea?" counts. A task sentence does not.
 */
export const asksAboutOpenProject = (prompt: string): boolean => {
    // A request to create a project somewhere else is not a question about the folder that is already open.
    if (isLibraryPrompt(prompt) || isActionRequest(prompt)) {
        return false;
    }
    if (PROJECT_QUESTION.test(prompt)) {
        return true;
    }
    const text = oneLine(prompt).replace(LEADING_FILLER, '');
    if (QUESTION_START.test(text) || oneLine(prompt).endsWith('?')) {
        return true;
    }
    return text.split(' ').some(isProjectToken);
};

const projectProse = (source: string): string => source
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('---') && !line.startsWith('>') && !line.startsWith('![') && !line.startsWith('- ') && !line.startsWith('* '))
    .slice(0, PROJECT_INTRO_LINES)
    .join(' ');

export const FILE_ANSWER_PATHS = 12;
const NOT_A_FILE_EXT = new Set(['the', 'some', 'any', 'there', 'these', 'those', 'many', 'few', 'all', 'no', 'my', 'your', 'this', 'that', 'are', 'is']);
const FILE_EXT_IN_QUESTION = /\b([a-z][a-z0-9]{0,7})\s+files?\b/i;
const FILE_EXT_IN_GLOB = /\*\.([a-z0-9]{1,8})\b/i;

/** A question about files in the open folder, such as "are there tsx files here?". */
export const fileQuestionGlob = (prompt: string): string | undefined => {
    const text = oneLine(prompt);
    const ext = (FILE_EXT_IN_GLOB.exec(text)?.[1] ?? FILE_EXT_IN_QUESTION.exec(text)?.[1])?.toLowerCase();
    if (!ext || NOT_A_FILE_EXT.has(ext)) {
        return undefined;
    }
    return `**/*.${ext}`;
};

/** Paths from a glob tool result. The count header is dropped. */
export const globPaths = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(line => line.includes('.') && !line.includes(' ') && !line.startsWith('/') && !line.split(/[\\/]/).includes('..'));

/** Yes or no, from the files the glob actually found in the open folder. */
export const answerFromFiles = (folder: string, pattern: string, paths: readonly string[]): string => {
    const ext = pattern.startsWith('**/*') ? pattern.slice('**/*'.length) : pattern;
    if (!paths.length) {
        return `No ${ext} files in the open folder \`${folder}\`.`;
    }
    const shown = paths.slice(0, FILE_ANSWER_PATHS);
    const more = paths.length - shown.length;
    return [
        `Yes. ${paths.length} ${ext} file${paths.length === 1 ? '' : 's'} in the open folder \`${folder}\`.`,
        shown.map(path => `- \`${path}\``).join('\n'),
        more > 0 ? `${more} more in that folder.` : ''
    ].filter(Boolean).join('\n\n');
};
export const answerFromProject = (folder: string, files: readonly { path: string; text: string }[]): string => {
    const pkgRaw = files.find(file => file.path === 'package.json')?.text ?? '';
    let name = folder;
    let description = '';
    let scripts = '';
    try {
        const json = JSON.parse(pkgRaw) as { name?: unknown; description?: unknown; scripts?: Record<string, unknown> };
        if (typeof json.name === 'string' && json.name.trim()) {
            name = json.name.trim();
        }
        if (typeof json.description === 'string') {
            description = json.description.trim();
        }
        if (json.scripts && typeof json.scripts === 'object') {
            const commands = Object.entries(json.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
            const preferred = SCRIPT_PREVIEW.filter(script => commands.some(([name]) => name === script));
            const shown = preferred.length ? preferred : commands.slice(0, SCRIPT_PREVIEW.length).map(([script]) => script);
            scripts = shown.map(script => `- \`${script}\`: ${commands.find(([name]) => name === script)?.[1] ?? ''}`).join('\n');
        }
    } catch {
        // package.json missing or not JSON
    }
    const readme = files.find(file => file.path === 'README.md')?.text ?? '';
    const agents = files.find(file => file.path === 'AGENTS.md')?.text ?? '';
    const intro = [projectProse(readme), projectProse(agents)].filter(Boolean).join(' ');
    const read = files.filter(file => file.path !== '.').map(file => file.path);
    return [
        `This is **${name}**, read from the open folder \`${folder}\`.`,
        description,
        intro ? `The idea: ${intro}` : '',
        scripts ? `Scripts:\n${scripts}` : '',
        read.length ? `Read ${read.map(path => `\`${path}\``).join(', ')}.` : ''
    ].filter(Boolean).join('\n\n');
};

/** A safe matcher for grep: literal by default, regex on request (invalid regex falls back to literal). */
export const grepMatcher = (pattern: string, regex: boolean): ((line: string) => boolean) => {
    if (regex) {
        try {
            const re = new RegExp(pattern, 'i');
            return line => re.test(line);
        } catch {
            // fall through to literal
        }
    }
    const needle = pattern.toLowerCase();
    return line => line.toLowerCase().includes(needle);
};

/** `*.ts`, `src/**\/*.tsx`, `package.json`: a small glob for grep's file filter (matched against the relative path or its base name). */
export const globMatcher = (glob: string | undefined): ((path: string) => boolean) => {
    if (!glob?.trim()) {
        return () => true;
    }
    const src = glob.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '@@DS@@').replace(/\*\*/g, '@@S@@').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
        .replace(/@@DS@@/g, '(?:.*/)?').replace(/@@S@@/g, '.*');
    const re = new RegExp(`^${src}$`, 'i');
    return path => re.test(path) || re.test(path.split('/').pop() ?? path);
};

export const GLOB_MAX_PATHS = 200;
const RG_MAX_COLUMNS = 200;

export interface RgQuery {
    readonly pattern?: string;
    readonly path?: string;
    readonly glob?: string;
    readonly regex?: boolean;
    /** List files instead of matching lines. */
    readonly files: boolean;
    /** IDEA-287: several file globs at once (files mode), instead of `glob`. */
    readonly globs?: readonly string[];
    /** IDEA-294: extra gitignore-style files (`.ingotignore`), paths relative to the search root. */
    readonly ignoreFiles?: readonly string[];
}

/** Arguments for ripgrep. Gitignore is on by default; hidden files are included so `.ingot` is visible, `.git` is not. */
export const rgArgs = (query: RgQuery): string[] => {
    const args = ['--color', 'never', '--hidden', '--glob', '!.git/**', '--glob', '!**/node_modules/**', '--max-filesize', '512K'];
    for (const file of query.ignoreFiles ?? []) {
        args.push('--ignore-file', file);
    }
    // The last matching glob wins in ripgrep, so the index folder is excluded after the caller's glob.
    const noIndex = ['--glob', `!${INDEX_DIR}/**`];
    if (query.files) {
        const globs = query.globs?.length ? query.globs : [query.glob?.trim() || '*'];
        args.push('--files', ...globs.flatMap(g => ['--glob', g]), '--glob', '!.git/**', ...noIndex);
        if (query.path?.trim()) {
            args.push(query.path.trim());
        }
        return args;
    }
    args.push('--line-number', '--no-heading', '--max-columns', String(RG_MAX_COLUMNS), '--max-count', String(GREP_MAX_MATCHES), '--ignore-case');
    if (!query.regex) {
        args.push('--fixed-strings');
    }
    if (query.glob?.trim()) {
        args.push('--glob', query.glob.trim());
    }
    args.push(...noIndex, '--', query.pattern ?? '', query.path?.trim() || '.');
    return args;
};

/** One path per line (`rg --files`). */
export const parseRgFiles = (text: string, max = GLOB_MAX_PATHS): string[] =>
    text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, max);

/** `path:line:text` lines from ripgrep. */
export const parseRgMatches = (text: string, max = GREP_MAX_MATCHES): string[] => {
    const hits: string[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim() || line.startsWith('--')) {
            continue;
        }
        hits.push(line.trim().slice(0, RG_MAX_COLUMNS + 80));
        if (hits.length >= max) {
            break;
        }
    }
    return hits;
};

/**
 * A small .gitignore matcher (ripgrep applies the real rules; the file walker uses this when ripgrep is absent).
 * Last matching rule wins, so a later `!keep` can un-ignore.
 */
export const compileGitignore = (text: string | undefined): (rel: string) => boolean => {
    const rules = (text ?? '').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (!rules.length) {
        return () => false;
    }
    return rel => {
        const path = rel.replace(/^\.\//, '').replace(/\\/g, '/');
        let ignored = false;
        for (const rule of rules) {
            const negate = rule.startsWith('!');
            const body = (negate ? rule.slice(1) : rule).trim().replace(/^\//, '');
            if (body && gitRuleMatches(body, path)) {
                ignored = !negate;
            }
        }
        return ignored;
    };
};

const gitRuleMatches = (rule: string, rel: string): boolean => {
    const dirOnly = rule.endsWith('/');
    const body = rule.replace(/\/$/, '');
    if (!body) {
        return false;
    }
    if (dirOnly) {
        return rel === body || rel.startsWith(`${body}/`);
    }
    if (body.includes('/')) {
        return globMatcher(body)(rel) || globMatcher(`${body}/**`)(rel);
    }
    return globMatcher(body)(rel) || globMatcher(body)(rel.split('/').pop() ?? rel) || rel.split('/').includes(body);
};

/** Numbered lines for read_file, capped. */
export const numberLines = (content: string, start = 1, end?: number): { text: string; total: number; shown: [number, number] } => {
    const lines = content.split('\n');
    const from = Math.max(1, Math.floor(start) || 1);
    const to = Math.min(lines.length, end && end >= from ? Math.floor(end) : from + READ_MAX_LINES - 1, from + READ_MAX_LINES - 1);
    let text = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join('\n');
    if (text.length > READ_MAX_CHARS) {
        text = `${text.slice(0, READ_MAX_CHARS)}\n… (cut)`;
    }
    return { text, total: lines.length, shown: [from, to] };
};
