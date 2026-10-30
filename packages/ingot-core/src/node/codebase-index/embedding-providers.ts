import { DEFAULT_OLLAMA_EMBED_MODEL, EMBED_TIMEOUT_MS, LOCAL_EMBED_DIMS, OLLAMA_EMBED_PATH } from '../../common/codebase-index/codebase-index.consts';
import type { EmbeddingProvider, EmbeddingSettings } from '../../common/codebase-index/codebase-index.types';
import { hashEmbed, normalize } from '../../common/codebase-index/codebase-index.utils';
import { DEFAULT_OLLAMA_URL } from '../../common/models/models.consts';

const LOCAL_KEY_VERSION = 'hash-v1';

/** Runs in the backend, sends nothing anywhere and costs no tokens. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
    readonly key = `local:${LOCAL_KEY_VERSION}:${LOCAL_EMBED_DIMS}`;
    readonly label = 'local';

    async embed(texts: readonly string[]): Promise<Float32Array[]> {
        return texts.map(text => hashEmbed(text, LOCAL_EMBED_DIMS));
    }
}

/** A local Ollama embedding model (`/api/embed`). Ollama takes no key, so nothing secret leaves the machine. */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly key: string;
    readonly label: string;
    protected readonly baseUrl: string;

    constructor(baseUrl: string | undefined, protected readonly model: string) {
        this.baseUrl = (baseUrl?.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
        this.key = `ollama:${model}`;
        this.label = `ollama ${model}`;
    }

    async embed(texts: readonly string[]): Promise<Float32Array[]> {
        if (!texts.length) {
            return [];
        }
        const response = await fetch(`${this.baseUrl}${OLLAMA_EMBED_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: texts }),
            signal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
        });
        const json = await response.json().catch(() => ({})) as { embeddings?: unknown; error?: unknown };
        if (!response.ok || !Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
            throw new Error(typeof json.error === 'string' ? `Ollama: ${json.error}` : `Ollama embeddings failed (${response.status}).`);
        }
        return json.embeddings.map(row => normalize(Float32Array.from(Array.isArray(row) ? row.map(Number) : [])));
    }
}

export const createEmbeddingProvider = (settings: EmbeddingSettings): EmbeddingProvider =>
    settings.provider === 'ollama'
        ? new OllamaEmbeddingProvider(settings.ollamaBaseUrl, settings.ollamaModel?.trim() || DEFAULT_OLLAMA_EMBED_MODEL)
        : new LocalEmbeddingProvider();
