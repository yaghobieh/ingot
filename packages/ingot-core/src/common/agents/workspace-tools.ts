/**
 * IDEA-186: local-first code reading. Read-only workspace tools (read_file, list_dir, grep) that run at once, the
 * system-prompt section that tells the agent to use them before any remote (GitHub) tool, and the GitHub owner/repo
 * taken from the workspace's git remote (never guessed, never empty).
 */
import type { AgentToolCall } from './agent-protocol';

export const WORKSPACE_TOOLS = [
    { name: 'list_dir', description: 'List a folder of the open project. Arguments: {"path"?: "src", "depth"?: 1..3}. Runs at once.' },
    { name: 'read_file', description: 'Read a file of the open project with line numbers. Arguments: {"path": "package.json", "start"?: 1, "end"?: 200}. Runs at once.' },
    { name: 'grep', description: 'Search the open project\'s files for text or a regex. Arguments: {"pattern": "useCart", "path"?: "src", "glob"?: "*.ts", "regex"?: false}. Runs at once.' }
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
export const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'build', 'out', '.next', '.turbo', 'coverage', '.cache', '.venv', '__pycache__', 'target']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|mov|wasm|exe|dll|so|dylib|bin|lock)$/i;
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
    readonly github?: GitHubRepo;
}

/** The system-prompt section: local tools first, GitHub only for remote questions, run commands instead of printing them. */
export const workspaceProtocol = (info: WorkspaceInfo): string => [
    'Project tools (same block format, server "ingot"; read-only, they run at once):',
    ...WORKSPACE_TOOLS.map(t => `- ingot/${t.name}: ${t.description}`),
    `The open project${info.name ? ` is "${info.name}"` : ''}${info.branch ? ` on branch ${info.branch}` : ''}.`,
    'For ANY question about this project or its code ("what do you know about…", "how does … work", "learn the code"), explore it with',
    'ingot/list_dir, ingot/grep and ingot/read_file FIRST, then answer from what you read. Do not answer from memory and do not use remote tools for it.',
    info.github
        ? `Use GitHub tools only when the user asks about the remote repository (pull requests, issues, other branches on GitHub). This project's repository is ${info.github.owner}/${info.github.repo} (owner "${info.github.owner}", repo "${info.github.repo}", from its git remote); use exactly those, never guess.`
        : 'This project has no GitHub remote: do not call GitHub tools for it.',
    'Never print shell commands (```bash blocks such as cat, ls, grep) for the user to run: read files with ingot/read_file, or call ingot/run yourself.'
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

/** True when a reply with no tool calls hands the user shell commands to run (```bash / ```sh blocks). */
export const printsShellInsteadOfRunning = (reply: string): boolean => /```(?:bash|sh|shell|zsh|console)\s*\n\s*\$?\s*(cat|ls|head|tail|grep|rg|find|tree|wc|less|more|npm|pnpm|yarn|git|node)\b/i.test(reply);

export const SHELL_NUDGE = 'You printed shell commands instead of running them. Do not ask the user to run anything: read files with ingot/read_file, list with ingot/list_dir, search with ingot/grep, or call ingot/run yourself, then answer.';

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
