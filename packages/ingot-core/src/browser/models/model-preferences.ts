import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { interfaces } from '@theia/core/shared/inversify';
import { DEFAULT_OLLAMA_URL, MODEL_CATALOG, MODEL_PREFERENCES } from '../../common/models/models.consts';

/** Non-secret model settings. API keys are never preferences: they live in the OS keychain. */
export const modelPreferenceSchema: PreferenceSchema = {
    properties: {
        [MODEL_PREFERENCES.byok]: { type: 'boolean', default: false, description: 'Use my own API keys (BYOK) and local models (Ollama) in addition to Ingot models.' },
        [MODEL_PREFERENCES.ollamaUrl]: { type: 'string', default: DEFAULT_OLLAMA_URL, description: 'Base URL of the local Ollama server.' },
        [MODEL_PREFERENCES.overrides]: { type: 'object', default: {}, description: 'Provider model name overrides, e.g. { "ollama": "llama3.2" }.' },
        [MODEL_PREFERENCES.autocompleteModel]: { type: 'string', default: '', enum: ['', ...MODEL_CATALOG.map(m => m.id)], description: 'Model for Tab predictions; empty picks the first connected fast model (Ingot Fast when signed in).' }
    }
};

export const bindModelPreferences = (bind: interfaces.Bind): void => {
    bind(PreferenceContribution).toConstantValue({ schema: modelPreferenceSchema });
};
