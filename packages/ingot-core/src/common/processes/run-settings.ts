import { FOREGROUND_TIMEOUT_MS, PROCESS_AGENT_OUTPUT_CHARS } from './processes.consts';

/** IDEA-131/133: Settings › Tools › Agent tools. */
export const RUN_PREFS = {
    enabled: 'ingot.agent.terminal.enabled',
    requireApproval: 'ingot.agent.terminal.requireApproval',
    foregroundTimeoutSeconds: 'ingot.agent.terminal.foregroundTimeoutSeconds',
    maxOutputChars: 'ingot.agent.terminal.maxOutputChars',
    showProcesses: 'ingot.agent.processes.showInChat'
} as const;

export interface RunToolSettings {
    readonly enabled: boolean;
    readonly requireApproval: boolean;
    readonly foregroundTimeoutSeconds: number;
    readonly maxOutputChars: number;
    readonly showProcesses: boolean;
}

export const RUN_DEFAULTS: RunToolSettings = {
    enabled: true, requireApproval: true, foregroundTimeoutSeconds: FOREGROUND_TIMEOUT_MS / 1000, maxOutputChars: PROCESS_AGENT_OUTPUT_CHARS, showProcesses: true
};

const bool = (v: unknown, d: boolean): boolean => typeof v === 'boolean' ? v : d;
const num = (v: unknown, d: number, min: number, max: number): number => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;

/** Settings with defaults and sane bounds (the settings file is user-edited). */
export const runToolSettings = (get: (key: string) => unknown): RunToolSettings => ({
    enabled: bool(get(RUN_PREFS.enabled), RUN_DEFAULTS.enabled),
    requireApproval: bool(get(RUN_PREFS.requireApproval), RUN_DEFAULTS.requireApproval),
    foregroundTimeoutSeconds: num(get(RUN_PREFS.foregroundTimeoutSeconds), RUN_DEFAULTS.foregroundTimeoutSeconds, 5, 3600),
    maxOutputChars: num(get(RUN_PREFS.maxOutputChars), RUN_DEFAULTS.maxOutputChars, 1000, 200_000),
    showProcesses: bool(get(RUN_PREFS.showProcesses), RUN_DEFAULTS.showProcesses)
});
