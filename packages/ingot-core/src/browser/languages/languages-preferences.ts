import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { LANGUAGE_PREFS } from '../../common/languages/languages.consts';

/** IDEA-313: Settings › Languages. */
export const languagesPreferenceSchema: PreferenceSchema = {
    properties: {
        [LANGUAGE_PREFS.toolchainPrompts]: {
            type: 'boolean', default: true,
            description: 'When a file opens and its compiler or runtime is missing, show how to install it.'
        },
        [LANGUAGE_PREFS.dismissed]: {
            type: 'array', items: { type: 'string' }, default: [],
            description: 'Toolchains Ingot no longer offers to install ("Don\'t Ask Again").'
        }
    }
};
