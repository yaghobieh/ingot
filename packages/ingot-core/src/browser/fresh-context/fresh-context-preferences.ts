import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import {
    DEFAULT_FRESH_MODE, DEFAULT_ROT_FAILURES, DEFAULT_ROT_RATIO, DEFAULT_ROT_TURNS, FRESH_MODES, FRESH_PREFS, HANDOFFS_DIR, MAX_ROT_RATIO, MIN_ROT_FAILURES, MIN_ROT_RATIO
} from '../../common/fresh-context/fresh-context.consts';
import { MAX_HANDOFF_TURNS, MIN_HANDOFF_TURNS } from '../../common/habits/learned.consts';

/** IDEA-305 Fresh-Context Auto-Handoff (Settings › Tools › Context, plans & cost). */
export const freshContextPreferenceSchema: PreferenceSchema = {
    properties: {
        [FRESH_PREFS.mode]: {
            type: 'string', enum: [...FRESH_MODES], default: DEFAULT_FRESH_MODE,
            enumDescriptions: ['Never', 'Offer a fresh chat when the chat looks stale', 'Hand off to a fresh chat automatically'],
            description: `Fresh context: when a chat goes stale (repeated failures, many turns, a full context window), continue in a new chat seeded with a brief of the plan, decisions and diff. Briefs are saved in ${HANDOFFS_DIR}.`
        },
        [FRESH_PREFS.turns]: {
            type: 'number', default: DEFAULT_ROT_TURNS, minimum: MIN_HANDOFF_TURNS, maximum: MAX_HANDOFF_TURNS,
            description: 'Fresh context: offer a fresh chat after this many turns. Habits learns your own threshold from the handoffs you accept.'
        },
        [FRESH_PREFS.failures]: {
            type: 'number', default: DEFAULT_ROT_FAILURES, minimum: MIN_ROT_FAILURES,
            description: 'Fresh context: failed tool calls, checks or model requests in one turn before a fresh chat is offered.'
        },
        [FRESH_PREFS.tokenRatio]: {
            type: 'number', default: DEFAULT_ROT_RATIO, minimum: MIN_ROT_RATIO, maximum: MAX_ROT_RATIO,
            description: 'Fresh context: share of the context window (0.1 to 1) the last request may use before a fresh chat is offered.'
        }
    }
};
