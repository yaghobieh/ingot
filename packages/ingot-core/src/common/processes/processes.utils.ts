import type { PackageManager, ProcessInfo } from './processes.types';
import { LOCKFILES } from './processes.consts';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\r(?!\n)/g;

/** Output without terminal colour codes or carriage-return redraws. */
export const stripAnsi = (text: string): string => text.replace(ANSI, '');

/** Appends to a tail buffer that keeps at most `max` characters. */
export const appendTail = (buffer: string, chunk: string, max: number): { text: string; dropped: boolean } => {
    const next = buffer + chunk;
    return next.length > max ? { text: next.slice(next.length - max), dropped: true } : { text: next, dropped: false };
};

const PORT_PATTERNS = [
    /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w.-]+\.local):(\d{2,5})\b/gi,
    /\b(?:listening|running|started|serving|ready|available)\b[^\n]{0,40}?\bport\s*:?\s*(\d{2,5})\b/gi,
    /\bport\s+(\d{2,5})\b/gi
];

/** Ports a dev server announces in its output, in first-seen order. */
export const detectPorts = (text: string): number[] => {
    const found: number[] = [];
    for (const pattern of PORT_PATTERNS) {
        for (const m of stripAnsi(text).matchAll(pattern)) {
            const port = Number(m[1]);
            if (port >= 80 && port <= 65535 && !found.includes(port)) {
                found.push(port);
            }
        }
    }
    return found;
};

/** The package manager a project uses, from its lockfiles (npm when none). */
export const packageManagerFor = (files: readonly string[]): PackageManager =>
    LOCKFILES.find(l => files.includes(l.file))?.manager ?? 'npm';

export const scriptCommand = (manager: PackageManager, script: string): string =>
    manager === 'npm' ? `npm run ${script}` : `${manager} run ${script}`;

/** `scripts` of a package.json text (empty when unreadable). */
export const parseScripts = (packageJson: string): Record<string, string> => {
    try {
        const scripts = (JSON.parse(packageJson) as { scripts?: unknown }).scripts;
        if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
            return {};
        }
        return Object.fromEntries(Object.entries(scripts as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch {
        return {};
    }
};

/** Script names are plain words; anything else could inject shell syntax. */
export const isSafeScriptName = (name: string): boolean => /^[\w:@./-]+$/.test(name);

/** "4s", "2m 05s", "1h 02m". */
export const formatUptime = (ms: number): string => {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) {
        return `${s}s`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
        return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    }
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** How long a process ran (or has been running). */
export const uptimeOf = (p: Pick<ProcessInfo, 'startedAt' | 'endedAt'>, now: number): number => (p.endedAt ?? now) - p.startedAt;

export const STATUS_LABELS: Record<ProcessInfo['status'], string> = { running: 'Running', exited: 'Done', failed: 'Failed', stopped: 'Stopped' };

/** Final status from an exit code / signal. */
export const finalStatus = (code: number | null, stopRequested: boolean): ProcessInfo['status'] =>
    stopRequested ? 'stopped' : code === 0 ? 'exited' : 'failed';

/** One line per process for the agent's `ingot/processes` tool. */
export const describeProcesses = (list: readonly ProcessInfo[], now: number): string => list.length
    ? list.map(p => `${p.id} [${STATUS_LABELS[p.status]}${p.exitCode !== undefined && p.status !== 'running' ? ` ${p.exitCode}` : ''}] ${p.command}`
        + ` · ${formatUptime(uptimeOf(p, now))}${p.ports.length ? ` · port ${p.ports.join(', ')}` : ''} · started by ${p.origin}`).join('\n')
    : 'No processes.';

/** Running first (newest first), then finished (newest first). */
export const sortProcesses = (list: readonly ProcessInfo[]): ProcessInfo[] => [...list].sort((a, b) =>
    (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.startedAt - a.startedAt);

/** IDEA-132: the chat lists running processes and finished background ones (until cleared); finished foreground commands stay in the transcript. */
export const isListed = (p: Pick<ProcessInfo, 'status' | 'background'>): boolean => p.status === 'running' || p.background;
