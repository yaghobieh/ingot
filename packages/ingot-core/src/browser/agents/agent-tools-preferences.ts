import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { RUN_DEFAULTS, RUN_PREFS } from '../../common/processes/run-settings';
import { BROWSER_DEFAULTS, BROWSER_PREFS } from '../../common/browser-tool/browser-settings';

/** IDEA-133: Settings › Tools › Agent tools (terminal, processes, browser). Also editable in settings.json. */
export const agentToolsPreferenceSchema: PreferenceSchema = {
    properties: {
        [RUN_PREFS.enabled]: {
            type: 'boolean', default: RUN_DEFAULTS.enabled,
            description: 'The agent can run shell commands and package.json scripts (ingot/run, ingot/run_script). Off: those tools are hidden from the agent; it can still list scripts and processes.'
        },
        [RUN_PREFS.requireApproval]: {
            type: 'boolean', default: RUN_DEFAULTS.requireApproval,
            description: 'Commands wait for Run on the approval card. "Always Run" on a card remembers that exact command for the project. Off: commands run right away.'
        },
        [RUN_PREFS.foregroundTimeoutSeconds]: {
            type: 'number', minimum: 5, maximum: 3600, default: RUN_DEFAULTS.foregroundTimeoutSeconds,
            description: 'How long the agent waits for a foreground command. A command still running after this keeps running in the background.'
        },
        [RUN_PREFS.maxOutputChars]: {
            type: 'number', minimum: 1000, maximum: 200000, default: RUN_DEFAULTS.maxOutputChars,
            description: 'The most command output (the latest characters) sent to the agent per result.'
        },
        [RUN_PREFS.showProcesses]: {
            type: 'boolean', default: RUN_DEFAULTS.showProcesses,
            description: 'Show the Processes list (command, status, uptime, port, Stop) above the chat composer while something runs in the background.'
        },
        [BROWSER_PREFS.enabled]: {
            type: 'boolean', default: BROWSER_DEFAULTS.enabled,
            description: 'The agent can open pages in the Ingot browser panel, read them, click, type, scroll and take screenshots. Off: the browser tools are hidden from the agent.'
        },
        [BROWSER_PREFS.requireApproval]: {
            type: 'boolean', default: BROWSER_DEFAULTS.requireApproval,
            description: 'Opening pages, clicking, typing, scrolling and going back wait for Run on the approval card. Off: they run right away.'
        },
        [BROWSER_PREFS.approveReads]: {
            type: 'boolean', default: BROWSER_DEFAULTS.approveReads,
            description: 'Reading the page and screenshots ask too. Off (default): they run at once.'
        }
    }
};
