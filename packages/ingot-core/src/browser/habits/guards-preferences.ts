import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { DEFAULT_INFER_MIN_AGE_DAYS, DEFAULT_REVERT_THRESHOLD, FROZEN_FILE, FROZEN_PREFS } from '../../common/frozen/frozen.consts';
import { ANTI_HABITS_FILE, DEFAULT_MAX_REPEATS, DOOM_PREFS, MIN_MAX_REPEATS } from '../../common/doom-loop/doom-loop.consts';

/** IDEA-303 Frozen Zones and IDEA-304 Doom-Loop Breaker (Settings › AI › Frozen Zones / Agent). */
export const guardsPreferenceSchema: PreferenceSchema = {
    properties: {
        [FROZEN_PREFS.revertThreshold]: {
            type: 'number', default: DEFAULT_REVERT_THRESHOLD, minimum: 1,
            description: `Frozen Zones: after how many rejected agent edits to the same file Ingot suggests freezing it (${FROZEN_FILE}).`
        },
        [FROZEN_PREFS.inferMinAgeDays]: {
            type: 'number', default: DEFAULT_INFER_MIN_AGE_DAYS, minimum: 0,
            description: 'Frozen Zones: "Freeze Stable Files" suggests tested files whose last commit is at least this many days old (tests must be green).'
        },
        [DOOM_PREFS.enabled]: {
            type: 'boolean', default: true,
            description: `Doom-loop breaker: pause the agent when it keeps hitting the same error, undoes its own fixes, or claims success the checks disprove. The failed approach is saved to ${ANTI_HABITS_FILE}.`
        },
        [DOOM_PREFS.maxRepeats]: {
            type: 'number', default: DEFAULT_MAX_REPEATS, minimum: MIN_MAX_REPEATS,
            description: 'Doom-loop breaker: how many times the same error may come back before the agent pauses.'
        }
    }
};
