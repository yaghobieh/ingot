import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { AI_SETTINGS_PREFS, ATTACH_ACTIVE_FILE_DEFAULT, DEFAULT_AGENT_MODES } from '../../common/agents/ai-settings';
import { MADE_WITH_PREF } from '../../common/git/made-with';

/** IDEA-182: agent defaults, the Zaprex button, Commit with AI and chat context (Settings › Tools › AI & Zaprex). */
export const aiSettingsPreferenceSchema: PreferenceSchema = {
    properties: {
        [AI_SETTINGS_PREFS.defaultMode]: {
            type: 'string', enum: [...DEFAULT_AGENT_MODES], default: 'agent',
            enumDescriptions: ['Agent: reads, edits and runs', 'Ask: answers only, no edits', 'Plan: writes a plan first', 'Debug: finds the cause, then fixes', 'Multi: splits the task into subagents'],
            description: 'Mode chats start in when Ingot opens. Each chat tab remembers its own mode, and the mode you switch to carries over to the next new chat.'
        },
        [AI_SETTINGS_PREFS.defaultModel]: {
            type: 'string', default: '',
            description: 'Model id new chats start with (for example auto or ollama-local). Empty: the model you picked last. Existing chats keep their model.'
        },
        [AI_SETTINGS_PREFS.zaprexButton]: {
            type: 'boolean', default: true,
            description: 'Show the Zaprex T-rex ("Hand off to Rex") in the title bar on PRO+ while an agent run is heavy: many files, a multi-step plan or a long run.'
        },
        [AI_SETTINGS_PREFS.attachActiveFile]: {
            type: 'boolean', default: ATTACH_ACTIVE_FILE_DEFAULT,
            description: 'Attach the file open in the editor to chat messages as a removable chip. Off: add files with @ or by pasting code.'
        },
        [AI_SETTINGS_PREFS.aiCommit]: {
            type: 'boolean', default: true,
            description: 'Show the Commit with AI button, which writes the commit message from the staged changes.'
        },
        [MADE_WITH_PREF]: {
            type: 'boolean', default: true,
            description: 'Add a "Made with Ingot" (or "Made with Zaprex") line at the end of commit messages the agent, Commit with AI or Zaprex wrote.'
        }
    }
};
