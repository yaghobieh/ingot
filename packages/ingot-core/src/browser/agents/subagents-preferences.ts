import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { SUBAGENT_PREFS, SUBAGENT_VIEWS } from '../../common/agents/subagents';

/** IDEA-181: how subagents show above the composer (Settings › AI & Zaprex). */
export const subagentsPreferenceSchema: PreferenceSchema = {
    properties: {
        [SUBAGENT_PREFS.view]: {
            type: 'string', enum: [...SUBAGENT_VIEWS], default: 'strip',
            enumDescriptions: ['Strip: the list of subagents is open above the input', 'Compact: one line with a count; click it to see the list'],
            description: 'Subagents (Multi-agent subtasks and Zaprex pieces) run outside the main chat. Strip shows them as a list above the input; Compact shows one line until you open it.'
        }
    }
};
