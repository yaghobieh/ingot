import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { interfaces } from '@theia/core/shared/inversify';
import { DEFAULT_OLLAMA_URL, MODEL_CATALOG, MODEL_PREFERENCES } from '../../common/models/models.consts';

/** Non-secret model settings. API keys are never preferences: they live in Ingot's local key file (~/.ingot/keystore.json). */
export const modelPreferenceSchema: PreferenceSchema = {
    properties: {
        [MODEL_PREFERENCES.byok]: { type: 'boolean', default: false, description: 'Use my own API keys (BYOK) and local models (Ollama) in addition to Ingot models.' },
        [MODEL_PREFERENCES.ollamaUrl]: { type: 'string', default: DEFAULT_OLLAMA_URL, description: 'Base URL of the local Ollama server.' },
        [MODEL_PREFERENCES.overrides]: { type: 'object', default: {}, description: 'Provider model name overrides, e.g. { "ollama": "llama3.2" }.' },
        [MODEL_PREFERENCES.autocompleteEnabled]: { type: 'boolean', default: true, description: 'Show inline AI completions (ghost text) in the editor.' },
        [MODEL_PREFERENCES.autocompleteModel]: { type: 'string', default: '', enum: ['', ...MODEL_CATALOG.map(m => m.id)], description: 'Model for inline completions; empty picks the first connected model.' },
        [MODEL_PREFERENCES.autocompleteDebounce]: { type: 'number', default: 300, minimum: 50, description: 'Delay (ms) after typing before asking for a completion.' }
    }
};

export const bindModelPreferences = (bind: interfaces.Bind): void => {
    bind(PreferenceContribution).toConstantValue({ schema: modelPreferenceSchema });
};
