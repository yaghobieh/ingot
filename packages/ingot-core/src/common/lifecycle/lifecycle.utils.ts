/**
 * IDEA-170: true when the process that forked us is gone. On Linux/macOS an orphan is re-parented (ppid changes,
 * usually to 1 or a subreaper); on Windows the ppid stays the same, so we also probe the original pid.
 */
export function isParentGone(originalPpid: number, currentPpid: number, isAlive: (pid: number) => boolean): boolean {
    if (originalPpid <= 1) {
        return false;
    }
    return currentPpid !== originalPpid || !isAlive(originalPpid);
}

/** `kill(pid, 0)` probes a process without signalling it: ESRCH means gone, EPERM means alive but not ours. */
export function isProcessAlive(pid: number, kill: (pid: number, signal: 0) => void = (p, s) => { process.kill(p, s); }): boolean {
    try {
        kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException)?.code === 'EPERM';
    }
}

/** Only the backend that Electron forked (IPC channel + Electron marker) should follow its parent's lifetime. */
export function isElectronForkedBackend(env: NodeJS.ProcessEnv, hasIpc: boolean, markerEnv: string): boolean {
    return hasIpc && !!env[markerEnv];
}
