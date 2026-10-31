import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { LEARNED_PREFS } from '../../common/learned-rules';

/** IDEA-328: learned rules from reviews (opt-in). */
export const learnedRulesPreferenceSchema: PreferenceSchema = {
    properties: {
        [LEARNED_PREFS.enabled]: {
            type: 'boolean', default: false,
            description: 'Learn rules from reviews: after you reject an agent change Ingot recognises (console.log, export default, any, …) or repeat the same correction in chat, '
                + 'Ingot drafts a rule for .ingot/rules and shows it as a diff to review. Nothing is written until you add it. What it noticed stays in .ingot/.state on this machine.'
        }
    }
};
