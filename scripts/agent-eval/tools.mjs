// Runs the agent's ingot/* tool calls inside one temp project. Nothing leaves that folder.
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
    ASK_USER_ANSWER, BLOCKED, BLOCKED_COMMAND, COMMAND_TIMEOUT_MS, CUT_MARK, KEYSTORE_ENV, MAX_GREP_MATCHES, MAX_LIST_DEPTH,
    MAX_RESULT_CHARS, NO_BACKGROUND, NO_GIT_WRITES, SKIP_DIRS, TOKEN_ENV, TOOL_SERVER
} from './eval.consts.mjs';

const READ_GIT_OPS = new Set(['status', 'diff', 'log']);
const ALLOWED_ABSOLUTE = ['/dev/null'];
const ABSOLUTE_PATH = /(?:^|[\s'"=])(\/[^\s'";|&]+)/g;

export const clip = (text, max = MAX_RESULT_CHARS) => text.length > max ? `${text.slice(0, max)}${CUT_MARK}` : text;

/** Absolute path of `path` when it stays inside `root`, else undefined. */
export const inside = (root, path = '.') => {
    const abs = resolve(root, String(path));
    return abs === root || abs.startsWith(`${root}${sep}`) ? abs : undefined;
};

export const listFiles = async (root, dir = root, depth = Infinity) => {
    const out = [];
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (SKIP_DIRS.has(entry.name)) { continue; }
        const abs = join(dir, entry.name);
        const rel = relative(root, abs).split(sep).join('/');
        if (entry.isDirectory()) {
            out.push(`${rel}/`);
            if (depth > 1) { out.push(...await listFiles(root, abs, depth - 1)); }
        } else {
            out.push(rel);
        }
    }
    return out;
};

const ANY_DIRS = '\uE000';

const globRegex = (pattern) => new RegExp(`^${String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, ANY_DIRS)
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .split(ANY_DIRS).join('(?:.*/)?')}$`);

const files = async (root, under = '.') => {
    const base = inside(root, under);
    return base ? (await listFiles(root, base)).filter(p => !p.endsWith('/')) : [];
};

/** Child env without the eval's own secrets. */
const childEnv = () => {
    const env = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
    delete env[TOKEN_ENV];
    delete env[KEYSTORE_ENV];
    return env;
};

export const runCommand = (command, cwd, timeoutMs = COMMAND_TIMEOUT_MS) => new Promise(done => {
    const child = spawn('sh', ['-c', command], { cwd, env: childEnv() });
    let output = '';
    const collect = chunk => { output += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { output += `\n(timed out after ${timeoutMs} ms)`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); done({ code: code ?? 1, output }); });
});

const blockedCommand = (root, command) => {
    if (BLOCKED_COMMAND.test(command)) { return true; }
    return [...command.matchAll(ABSOLUTE_PATH)].some(([, path]) => !inside(root, path) && !ALLOWED_ABSOLUTE.includes(path));
};

const run = async (ctx, command, cwdArg, background) => {
    if (background) { return NO_BACKGROUND; }
    const cwd = inside(ctx.root, cwdArg ?? '.');
    if (!command || !cwd || blockedCommand(ctx.root, command)) { return BLOCKED; }
    const { code, output } = await runCommand(command, cwd);
    ctx.commands.push({ command, code, editSeq: ctx.editSeq });
    return `Exit code ${code}\n${clip(output.trim(), MAX_RESULT_CHARS)}`;
};

const readPackage = async (root) => JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8').catch(() => '{}'));

const grep = async (ctx, args) => {
    const pattern = String(args.pattern ?? '');
    if (!pattern) { return 'Missing "pattern".'; }
    let matcher;
    try {
        matcher = args.regex ? new RegExp(pattern) : { test: line => line.includes(pattern) };
    } catch {
        return `Invalid regex: ${pattern}`;
    }
    const name = args.glob ? globRegex(String(args.glob).includes('/') ? args.glob : `**/${args.glob}`) : undefined;
    const hits = [];
    for (const file of await files(ctx.root, args.path)) {
        if (name && !name.test(file)) { continue; }
        const text = await fs.readFile(join(ctx.root, file), 'utf8').catch(() => '');
        text.split('\n').forEach((line, i) => { if (hits.length < MAX_GREP_MATCHES && matcher.test(line)) { hits.push(`${file}:${i + 1}: ${line.trim()}`); } });
    }
    return hits.length ? hits.join('\n') : 'No matches.';
};

/** Executes one `<<<TOOL ingot/<name>` call and returns the text the model sees as the tool result. */
export const executeTool = async (ctx, call, lib) => {
    const args = call.args ?? {};
    ctx.tools.push(`${call.server}/${call.tool}`);
    if (call.server !== TOOL_SERVER) { return `Tool ${call.server}/${call.tool} is not available.`; }
    switch (call.tool) {
        case 'list_dir': {
            const dir = inside(ctx.root, args.path);
            const depth = Math.min(Math.max(Number(args.depth) || 1, 1), MAX_LIST_DEPTH);
            return dir ? (await listFiles(ctx.root, dir, depth)).join('\n') || '(empty)' : BLOCKED;
        }
        case 'read_file': {
            const file = inside(ctx.root, args.path);
            if (!file || !existsSync(file)) { return `File not found: ${args.path}`; }
            const { text, total, shown } = lib.numberLines(await fs.readFile(file, 'utf8'), Number(args.start) || 1, args.end ? Number(args.end) : undefined);
            return `${args.path} (lines ${shown[0]}-${shown[1]} of ${total})\n${text}`;
        }
        case 'glob': {
            const matcher = globRegex(args.pattern ?? '**/*');
            const found = (await files(ctx.root, args.path)).filter(p => matcher.test(p) || matcher.test(p.split('/').pop()));
            return found.join('\n') || 'No files.';
        }
        case 'grep':
            return grep(ctx, args);
        case 'scripts': {
            const pkg = await readPackage(ctx.root);
            return JSON.stringify({ manager: 'npm', scripts: pkg.scripts ?? {} });
        }
        case 'run':
            return run(ctx, String(args.command ?? ''), args.cwd, args.background);
        case 'run_script':
            return run(ctx, `npm run ${String(args.script ?? args.name ?? '')}`, args.cwd, args.background);
        case 'git':
            if (!READ_GIT_OPS.has(String(args.op))) { return NO_GIT_WRITES; }
            return existsSync(join(ctx.root, '.git')) ? run(ctx, `git ${args.op}`) : 'Not a git repository.';
        case 'delete': {
            const file = inside(ctx.root, args.path);
            if (!file || file === ctx.root) { return BLOCKED; }
            await fs.rm(file, { force: true });
            ctx.editSeq += 1;
            return `Deleted ${args.path}.`;
        }
        case 'ask_user':
            return ASK_USER_ANSWER;
        default:
            return lib.unknownToolResult(call.tool, [...lib.WORKSPACE_TOOLS, ...lib.BUILTIN_TOOLS].map(t => t.name).filter(name => lib.builtinToolEnabled(name, ctx.switches)));
    }
};

/** Writes a whole-file `<<<EDIT path` block. Paths outside the project are refused. */
export const applyEdit = async (ctx, edit) => {
    const file = inside(ctx.root, edit.path);
    if (!file || file === ctx.root) { return false; }
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, edit.content);
    ctx.edits.push(edit.path);
    ctx.editSeq += 1;
    return true;
};
