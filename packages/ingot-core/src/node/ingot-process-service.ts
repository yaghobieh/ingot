import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { createRequire } from 'module';
import { rgArgs } from '../common/agents/workspace-tools';
import { RG_TIMEOUT_MS } from '../common/agents/work-loop.consts';
import type {
    ForegroundOptions, ForegroundResult, HookRunOptions, PackageScripts, ProcessClient, ProcessInfo, ProcessOutput, ProcessService, ProcessStartOptions,
    WorkspaceSearchQuery, WorkspaceSearchResult
} from '../common/processes/processes.types';
import type { HookRunOutput } from '../common/hooks/agent-hooks.types';
import { AGENT_HOOK_MAX_OUTPUT_CHARS, HOOK_CURSOR_PROJECT_ENV, HOOK_PROJECT_ENV } from '../common/hooks/agent-hooks.consts';
import { AGENT_IGNORE_FILES } from '../common/project-config/project-config.consts';
import {
    BACKGROUND_SETTLE_MS, FOREGROUND_TIMEOUT_MS, MAX_FINISHED_PROCESSES, PROCESS_AGENT_OUTPUT_CHARS, PROCESS_BUFFER_CHARS, PROCESS_LIST_DEBOUNCE_MS, STOP_GRACE_MS
} from '../common/processes/processes.consts';
import { appendTail, detectPorts, finalStatus, isSafeProjectPath, packageManagerFor, parseScripts, sortProcesses, stripAnsi } from '../common/processes/processes.utils';
import { registerClientDrop } from '../common/rpc/disconnected-client';
import { SANDBOX_DENIED_PATTERN } from '../common/policy/agent-policy.consts';
import { sandboxCommand } from '../common/policy/agent-policy.utils';

interface Entry {
    info: ProcessInfo;
    child?: ChildProcess;
    output: string;
    dropped: boolean;
    stopRequested: boolean;
    exited: Promise<void>;
}

let nextId = 1;

/**
 * IDEA-131/132: runs commands for the agent (and the user, from the chat's process list) in their own process group,
 * keeps the tail of their output, detects ports, and pushes live status to every window.
 */
@injectable()
export class IngotProcessService implements ProcessService {

    protected readonly entries = new Map<string, Entry>();
    protected readonly clients = new Set<ProcessClient>();
    protected notifyTimer?: ReturnType<typeof setTimeout>;

    constructor() {
        process.once('exit', () => this.killAll());
    }

    @postConstruct()
    protected watchDisconnect(): void {
        registerClientDrop(() => this.clients.clear());
    }

    setClient(client: ProcessClient | undefined): void {
        if (client) {
            this.clients.add(client);
        }
    }

    removeClient(client: ProcessClient): void {
        this.clients.delete(client);
    }

    dispose(): void {
        this.killAll();
    }

    async list(): Promise<ProcessInfo[]> {
        return sortProcesses([...this.entries.values()].map(e => e.info));
    }

    async start(options: ProcessStartOptions): Promise<ProcessInfo> {
        const entry = this.spawn({ ...options, background: options.background ?? true });
        // Give a dev server a moment so the caller sees its first output (and port).
        await Promise.race([entry.exited, delay(BACKGROUND_SETTLE_MS)]);
        return entry.info;
    }

    async run(options: ForegroundOptions): Promise<ForegroundResult> {
        const entry = this.spawn({ ...options, background: false });
        const finished = await Promise.race([entry.exited.then(() => true), delay(options.timeoutMs ?? FOREGROUND_TIMEOUT_MS).then(() => false)]);
        if (!finished) {
            this.update(entry, { background: true });
        }
        const max = options.maxOutput ?? PROCESS_AGENT_OUTPUT_CHARS;
        const text = entry.output.length > max ? `… (${entry.output.length - max} earlier characters cut)\n${entry.output.slice(-max)}` : entry.output;
        const sandboxDenied = !!entry.info.sandboxed && entry.info.status !== 'running' && entry.info.exitCode !== 0 && SANDBOX_DENIED_PATTERN.test(entry.output);
        return { info: entry.info, output: text, movedToBackground: !finished, ...(sandboxDenied ? { sandboxDenied } : {}) };
    }

    async readText(cwd: string, relativePath: string): Promise<string | undefined> {
        const full = this.projectFile(cwd, relativePath);
        if (!full) {
            return undefined;
        }
        return fs.promises.readFile(full, 'utf8').catch(() => undefined);
    }

    async writeText(cwd: string, relativePath: string, content: string): Promise<void> {
        const full = this.projectFile(cwd, relativePath);
        if (!full) {
            throw new Error(`Refusing to write "${relativePath}".`);
        }
        await fs.promises.mkdir(path.dirname(full), { recursive: true });
        await fs.promises.writeFile(full, content, 'utf8');
    }

    protected projectFile(cwd: string, relativePath: string): string | undefined {
        if (!isSafeProjectPath(relativePath)) {
            return undefined;
        }
        const root = path.resolve(cwd);
        const full = path.resolve(root, relativePath);
        if (full !== root && !full.startsWith(root + path.sep)) {
            return undefined;
        }
        return full;
    }

    async output(id: string, maxChars = PROCESS_AGENT_OUTPUT_CHARS): Promise<ProcessOutput | undefined> {
        const entry = this.entries.get(id);
        if (!entry) {
            return undefined;
        }
        const cut = entry.output.length > maxChars;
        return { id, text: cut ? entry.output.slice(-maxChars) : entry.output, truncated: cut || entry.dropped };
    }

    async stop(id: string): Promise<boolean> {
        const entry = this.entries.get(id);
        if (!entry || entry.info.status !== 'running' || !entry.child) {
            return false;
        }
        entry.stopRequested = true;
        this.signal(entry.child, 'SIGTERM');
        const killer = setTimeout(() => entry.child && this.signal(entry.child, 'SIGKILL'), STOP_GRACE_MS);
        await entry.exited;
        clearTimeout(killer);
        return true;
    }

    async clearFinished(): Promise<void> {
        for (const [id, entry] of this.entries) {
            if (entry.info.status !== 'running') {
                this.entries.delete(id);
            }
        }
        this.notify();
    }

    /** IDEA-248: ripgrep over the open project. A miss returns `engine: 'none'` so the caller can walk the tree. */
    async workspaceSearch(query: WorkspaceSearchQuery): Promise<WorkspaceSearchResult> {
        const bin = ripgrepBinary();
        if (!bin || !query.cwd) {
            return { engine: 'none', text: '' };
        }
        const ignoreFiles = query.agentIgnore ? AGENT_IGNORE_FILES.filter(f => fs.existsSync(path.join(query.cwd, f))) : [];
        const args = rgArgs({ pattern: query.pattern, path: query.path, glob: query.glob, globs: query.globs, regex: query.regex, files: query.files, ignoreFiles });
        return new Promise(resolve => {
            let text = '';
            let settled = false;
            const finish = (result: WorkspaceSearchResult): void => {
                if (!settled) {
                    settled = true;
                    resolve(result);
                }
            };
            const child = spawn(bin, args, { cwd: query.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                finish({ engine: 'ripgrep', text });
            }, RG_TIMEOUT_MS);
            const add = (chunk: Buffer): void => {
                if (text.length < PROCESS_AGENT_OUTPUT_CHARS) {
                    text += chunk.toString('utf8');
                }
            };
            child.stdout?.on('data', add);
            child.stderr?.on('data', add);
            child.on('error', () => {
                clearTimeout(timer);
                finish({ engine: 'none', text: '' });
            });
            child.on('close', () => {
                clearTimeout(timer);
                finish({ engine: 'ripgrep', text });
            });
        });
    }

    async scripts(cwd: string): Promise<PackageScripts | undefined> {
        try {
            const text = await fs.promises.readFile(path.join(cwd, 'package.json'), 'utf8');
            return { manager: packageManagerFor(await fs.promises.readdir(cwd)), scripts: parseScripts(text) };
        } catch {
            return undefined;
        }
    }

    /** IDEA-294: one agent hook command. The payload goes to stdin; stdout / stderr come back capped; killed at the timeout. */
    async runHook(options: HookRunOptions): Promise<HookRunOutput> {
        const win = process.platform === 'win32';
        const shell = win ? { cmd: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', options.command] } : { cmd: process.env.SHELL || '/bin/sh', args: ['-c', options.command] };
        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let settled = false;
            const finish = (exitCode: number | undefined): void => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve({ stdout, stderr, timedOut, ...(exitCode !== undefined ? { exitCode } : {}) });
                }
            };
            const child = spawn(shell.cmd, shell.args, {
                cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: !win, windowsHide: true,
                env: { ...process.env, [HOOK_PROJECT_ENV]: options.cwd, [HOOK_CURSOR_PROJECT_ENV]: options.cwd }
            });
            const timer = setTimeout(() => {
                timedOut = true;
                this.signal(child, 'SIGKILL');
                finish(undefined);
            }, options.timeoutMs);
            child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-AGENT_HOOK_MAX_OUTPUT_CHARS); });
            child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-AGENT_HOOK_MAX_OUTPUT_CHARS); });
            child.on('error', error => {
                stderr += error.message;
                finish(1);
            });
            child.on('close', code => finish(code ?? undefined));
            child.stdin?.on('error', () => undefined);
            child.stdin?.end(options.input);
        });
    }

    protected spawn(options: ProcessStartOptions): Entry {
        const id = `p${nextId++}`;
        const win = process.platform === 'win32';
        const plain = win ? { cmd: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', options.command] } : { cmd: process.env.SHELL || '/bin/sh', args: ['-c', options.command] };
        const shell = options.sandbox ? sandboxCommand(plain, { ...options.sandbox, writable: options.sandbox.writable.map(realDir) }, process.platform) : { ...plain, applied: false };
        const info: ProcessInfo = {
            id, command: options.command, cwd: options.cwd, origin: options.origin ?? 'agent', status: 'running',
            background: !!options.background, startedAt: Date.now(), ports: [], ...(shell.applied ? { sandboxed: true } : {})
        };
        let resolveExit!: () => void;
        const entry: Entry = { info, output: '', dropped: false, stopRequested: false, exited: new Promise(r => { resolveExit = r; }) };
        this.entries.set(id, entry);
        this.prune();
        try {
            const child = spawn(shell.cmd, [...shell.args], {
                cwd: options.cwd, env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI ?? '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: !win, windowsHide: true
            });
            entry.child = child;
            this.update(entry, { pid: child.pid });
            const add = (chunk: Buffer): void => {
                const text = stripAnsi(chunk.toString('utf8'));
                const next = appendTail(entry.output, text, PROCESS_BUFFER_CHARS);
                entry.output = next.text;
                entry.dropped = entry.dropped || next.dropped;
                const ports = detectPorts(text).filter(p => !entry.info.ports.includes(p));
                if (ports.length) {
                    this.update(entry, { ports: [...entry.info.ports, ...ports] });
                }
            };
            child.stdout?.on('data', add);
            child.stderr?.on('data', add);
            child.on('error', error => {
                entry.output += `${error.message}\n`;
                this.finish(entry, 1, resolveExit);
            });
            child.on('close', code => this.finish(entry, code, resolveExit));
        } catch (error) {
            entry.output += `${error instanceof Error ? error.message : String(error)}\n`;
            this.finish(entry, 1, resolveExit);
        }
        this.notify();
        return entry;
    }

    protected finish(entry: Entry, code: number | null, resolve: () => void): void {
        if (entry.info.status !== 'running') {
            return;
        }
        this.update(entry, { status: finalStatus(code, entry.stopRequested), exitCode: code ?? undefined, endedAt: Date.now() });
        entry.child = undefined;
        resolve();
    }

    protected signal(child: ChildProcess, signal: NodeJS.Signals): void {
        if (!child.pid) {
            return;
        }
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            } else {
                // The whole group: `npm run dev` → node → vite.
                process.kill(-child.pid, signal);
            }
        } catch {
            child.kill(signal);
        }
    }

    protected update(entry: Entry, patch: Partial<ProcessInfo>): void {
        entry.info = { ...entry.info, ...patch };
        this.notify();
    }

    /** A closed client rejects the notification. Drop it instead of filling the disconnect buffer. */
    protected async pushList(): Promise<void> {
        const list = await this.list();
        for (const client of [...this.clients]) {
            try {
                void Promise.resolve(client.onProcessesChanged(list)).catch(() => {
                    this.clients.delete(client);
                });
            } catch {
                this.clients.delete(client);
            }
        }
    }

    protected prune(): void {
        const finished = [...this.entries.values()].filter(e => e.info.status !== 'running').sort((a, b) => a.info.startedAt - b.info.startedAt);
        for (const e of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_PROCESSES))) {
            this.entries.delete(e.info.id);
        }
    }

    protected notify(): void {
        if (this.notifyTimer) {
            return;
        }
        this.notifyTimer = setTimeout(() => {
            this.notifyTimer = undefined;
            void this.pushList();
        }, PROCESS_LIST_DEBOUNCE_MS);
    }

    protected killAll(): void {
        for (const entry of this.entries.values()) {
            if (entry.child && entry.info.status === 'running') {
                entry.stopRequested = true;
                this.signal(entry.child, 'SIGKILL');
            }
        }
    }
}

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** The sandbox matches real paths (`/var` is `/private/var` on macOS); a folder that does not exist yet stays as given. */
const realDir = (dir: string): string => {
    try {
        return fs.realpathSync(dir);
    } catch {
        return dir;
    }
};
const nodeRequire = createRequire(__filename);

const ripgrepBinary = (): string | undefined => {
    try {
        const found = nodeRequire('@vscode/ripgrep') as { rgPath?: string };
        return found.rgPath && fs.existsSync(found.rgPath) ? found.rgPath : undefined;
    } catch {
        return undefined;
    }
};
