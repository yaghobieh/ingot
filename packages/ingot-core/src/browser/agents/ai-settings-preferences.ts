import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { AI_SETTINGS_PREFS, DEFAULT_AGENT_MODES } from '../../common/agents/ai-settings';

/** IDEA-182: agent defaults, the Zaprex button and Commit with AI (Settings › Tools › AI & Zaprex). */
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
            description: 'Show the Zaprex T-rex in the title bar and the chat toolbar. Harmony mode offers still appear in the chat when it is hidden.'
        },
        [AI_SETTINGS_PREFS.aiCommit]: {
            type: 'boolean', default: true,
            description: 'Show the Commit with AI button, which writes the commit message from the staged changes.'
        }
    }
};
