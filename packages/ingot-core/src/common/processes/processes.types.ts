import type { RpcServer } from '@theia/core/lib/common/messaging';
import type { SandboxSpec } from '../policy/agent-policy.types';

/** IDEA-131/132: processes started by the agent (or the user from the chat's process list). */
export type ProcessStatus = 'running' | 'exited' | 'failed' | 'stopped';
export type ProcessOrigin = 'agent' | 'user';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ProcessInfo {
    readonly id: string;
    readonly command: string;
    readonly cwd: string;
    readonly origin: ProcessOrigin;
    readonly status: ProcessStatus;
    /** Long-running (dev server, watcher): the agent did not wait for it. */
    readonly background: boolean;
    readonly startedAt: number;
    readonly endedAt?: number;
    readonly exitCode?: number;
    readonly pid?: number;
    /** Ports found in the output ("Local: http://localhost:5173"). */
    readonly ports: readonly number[];
    /** IDEA-263: runs inside the OS sandbox (writes only in the project). */
    readonly sandboxed?: boolean;
}

export interface ProcessStartOptions {
    readonly cwd: string;
    readonly command: string;
    readonly origin?: ProcessOrigin;
    readonly background?: boolean;
    /** IDEA-263: run in the OS sandbox where the platform has one. */
    readonly sandbox?: SandboxSpec;
}

export interface ForegroundOptions extends ProcessStartOptions {
    /** Wait this long; a process still running then keeps running in the background. */
    readonly timeoutMs?: number;
    readonly maxOutput?: number;
}

export interface ForegroundResult {
    readonly info: ProcessInfo;
    readonly output: string;
    /** Still running after the timeout: it was moved to the background. */
    readonly movedToBackground: boolean;
    /** IDEA-263: the sandbox refused something the command tried (a write outside the project). */
    readonly sandboxDenied?: boolean;
}

export interface ProcessOutput {
    readonly id: string;
    readonly text: string;
    readonly truncated: boolean;
}

export interface PackageScripts {
    readonly manager: PackageManager;
    readonly scripts: Readonly<Record<string, string>>;
}

export interface ProcessClient {
    onProcessesChanged(processes: ProcessInfo[]): void;
}

export const ProcessService = Symbol('IngotProcessService');

export interface WorkspaceSearchQuery {
    readonly cwd: string;
    readonly pattern?: string;
    readonly path?: string;
    readonly glob?: string;
    readonly regex?: boolean;
    /** List matching files instead of matching lines. */
    readonly files: boolean;
}

export interface WorkspaceSearchResult {
    /** `ripgrep` when the bundled search binary ran; `none` asks the caller to walk the tree. */
    readonly engine: 'ripgrep' | 'none';
    readonly text: string;
}

export interface ProcessService extends RpcServer<ProcessClient> {
    list(): Promise<ProcessInfo[]>;
    /** Read-only project search. Does not appear in the process list. */
    workspaceSearch(query: WorkspaceSearchQuery): Promise<WorkspaceSearchResult>;
    /** Starts a process and returns at once (background). */
    start(options: ProcessStartOptions): Promise<ProcessInfo>;
    /** Starts a process and waits for it (up to `timeoutMs`). */
    run(options: ForegroundOptions): Promise<ForegroundResult>;
    /** The tail of a process's output (ANSI codes removed). */
    output(id: string, maxChars?: number): Promise<ProcessOutput | undefined>;
    /** Disk bytes of a project file. No editor cache. Undefined when the file is missing or the path is unsafe. */
    readText(cwd: string, relativePath: string): Promise<string | undefined>;
    /** Writes a project file on disk. Refuses paths outside the project. */
    writeText(cwd: string, relativePath: string, content: string): Promise<void>;
    stop(id: string): Promise<boolean>;
    /** Removes finished processes from the list. */
    clearFinished(): Promise<void>;
    scripts(cwd: string): Promise<PackageScripts | undefined>;
}
