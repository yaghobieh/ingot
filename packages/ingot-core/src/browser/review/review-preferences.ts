import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { REVIEW_DEFAULTS, REVIEW_PREFS } from '../../common/review/review';

/** IDEA-105: Settings › Agent review (also editable in the settings file under ~/.ingot). */
export const reviewPreferenceSchema: PreferenceSchema = {
    properties: {
        [REVIEW_PREFS.enabled]: {
            type: 'boolean', default: REVIEW_DEFAULTS.enabled,
            description: 'Review agent edits before they are kept. Off: edits apply right away, the agent never pauses and the changed-files list is for information only.'
        },
        [REVIEW_PREFS.pauseThreshold]: {
            type: 'number', minimum: 0, default: REVIEW_DEFAULTS.pauseThreshold,
            description: 'Pause an agent run for review after this many changed files. 0 = never pause.'
        },
        [REVIEW_PREFS.autoContinueSeconds]: {
            type: 'number', minimum: 0, default: REVIEW_DEFAULTS.autoContinueSeconds,
            description: 'A paused run continues by itself after this many seconds. 0 = wait for Continue.'
        },
        [REVIEW_PREFS.autoAccept]: {
            type: 'boolean', default: REVIEW_DEFAULTS.autoAccept,
            description: 'Accept every agent edit as it arrives (you can still revert to a checkpoint).'
        },
        [REVIEW_PREFS.inlineComments]: {
            type: 'boolean', default: REVIEW_DEFAULTS.inlineComments,
            description: 'Hover a changed file\'s line and click + to leave a review comment; Finish review sends them all to the agent.'
        }
    }
};
