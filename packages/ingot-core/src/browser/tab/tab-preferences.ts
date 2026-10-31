import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import type { interfaces } from '@theia/core/shared/inversify';
import {
    TAB_DEFAULT_DEBOUNCE_MS, TAB_DEFAULT_DEV_MODEL, TAB_DEFAULT_LIMITS, TAB_MIN_DEBOUNCE_MS, TAB_PREFERENCES
} from '../../common/tab/tab.consts';

export const tabPreferenceSchema: PreferenceSchema = {
    properties: {
        [TAB_PREFERENCES.enabled]: {
            type: 'boolean', default: true,
            description: 'Tab: show AI ghost text and next-edit hints while typing. Tab accepts, Ctrl/⌘+→ accepts a word, Esc dismisses. Files matched by .ingotignore are never sent.'
        },
        [TAB_PREFERENCES.debounceMs]: { type: 'number', default: TAB_DEFAULT_DEBOUNCE_MS, minimum: TAB_MIN_DEBOUNCE_MS, description: 'Tab: delay (ms) after typing before asking for a prediction.' },
        [TAB_PREFERENCES.maxRequestsPerDay]: { type: 'number', default: TAB_DEFAULT_LIMITS.maxRequestsPerDay, minimum: 0, description: 'Tab: at most this many predictions per day.' },
        [TAB_PREFERENCES.maxTokensPerDay]: { type: 'number', default: TAB_DEFAULT_LIMITS.maxTokensPerDay, minimum: 0, description: 'Tab: token budget per day (estimated, prompt plus reply).' },
        [TAB_PREFERENCES.devOpenRouter]: {
            type: 'boolean', default: false,
            description: 'Tab (development): call OpenRouter directly with your own OpenRouter key instead of the Ingot gateway.'
        },
        [TAB_PREFERENCES.devOpenRouterModel]: { type: 'string', default: TAB_DEFAULT_DEV_MODEL, description: 'Tab (development): OpenRouter model for the direct fallback.' }
    }
};

export const bindTabPreferences = (bind: interfaces.Bind): void => {
    bind(PreferenceContribution).toConstantValue({ schema: tabPreferenceSchema });
};
