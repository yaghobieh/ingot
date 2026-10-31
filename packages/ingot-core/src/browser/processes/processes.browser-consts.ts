import { Command } from '@theia/core/lib/common/command';

/** IDEA-132: the chat's process list. */
export const PROCESS_UPTIME_TICK_MS = 1_000;
export const PROCESS_OUTPUT_POLL_MS = 1_000;
/** The Rex mark on rows the agent started. */
export const PROCESS_ORIGIN_MARK_SIZE = 12;
export const PROCESSES_PINNED_KEY = 'ingot.processes.pinned';
export const PROCESS_COMMANDS = {
    run: Command.toDefaultLocalizedCommand({ id: 'ingot.processes.run', category: 'Processes', label: 'Run Script or Command…' }),
    stopAll: Command.toDefaultLocalizedCommand({ id: 'ingot.processes.stopAll', category: 'Processes', label: 'Stop All Processes' }),
    toggle: Command.toDefaultLocalizedCommand({ id: 'ingot.processes.toggle', category: 'Processes', label: 'Show Processes in Chat' })
};
