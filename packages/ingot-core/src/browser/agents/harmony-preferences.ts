import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { HARMONY_DEFAULTS, HARMONY_MAX_PIECES, HARMONY_PREFS } from '../../common/agents/harmony';

/** IDEA-180: Harmony mode, where Zaprex takes one scoped piece of a heavy agent run (Settings › AI & Zaprex). */
export const harmonyPreferenceSchema: PreferenceSchema = {
    properties: {
        [HARMONY_PREFS.enabled]: {
            type: 'boolean', default: HARMONY_DEFAULTS.enabled,
            description: 'Harmony mode: on a heavy agent run (many files or a long plan) Zaprex offers to take one well-scoped piece, such as the tests, and does it in parallel. Its files are locked to it and its edits are reviewed like the agent\'s.'
        },
        [HARMONY_PREFS.maxPieces]: {
            type: 'number', minimum: 1, maximum: HARMONY_MAX_PIECES, default: HARMONY_DEFAULTS.maxPieces,
            description: 'How many pieces Zaprex may take from one agent chat (each with its own files).'
        },
        [HARMONY_PREFS.askFirst]: {
            type: 'boolean', default: HARMONY_DEFAULTS.askFirst,
            description: 'Ask before Zaprex takes a piece (Accept / Dismiss under the T-rex). Off: Zaprex takes it right away.'
        }
    }
};
