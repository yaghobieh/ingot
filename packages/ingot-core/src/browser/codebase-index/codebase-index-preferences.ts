import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_OLLAMA_EMBED_MODEL, EMBEDDING_PROVIDERS, INDEX_DIR, INDEX_PREFS } from '../../common/codebase-index/codebase-index.consts';

/** IDEA-260: Settings › Tools › Codebase index. */
export const codebaseIndexPreferenceSchema: PreferenceSchema = {
    properties: {
        [INDEX_PREFS.enabled]: {
            type: 'boolean', default: true,
            description: `Index the open project for the agent's codebase_search tool. The index lives in ${INDEX_DIR} and updates when files change.`
        },
        [INDEX_PREFS.provider]: {
            type: 'string', enum: [...EMBEDDING_PROVIDERS], default: DEFAULT_EMBEDDING_PROVIDER,
            enumDescriptions: ['Built in: runs locally, free, no model needed.', 'A local Ollama embedding model (uses the Ollama URL from Settings › Models).'],
            description: 'How code is turned into vectors. Embeddings are cached by content, so only new or changed code is embedded again.'
        },
        [INDEX_PREFS.ollamaModel]: {
            type: 'string', default: DEFAULT_OLLAMA_EMBED_MODEL,
            description: 'Ollama embedding model used when the provider is "ollama".'
        }
    }
};
