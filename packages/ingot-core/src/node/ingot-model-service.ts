import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { DEFAULT_KEYCHAIN_SERVICE, MAX_DICTATION_BYTES, PROVIDERS, REQUEST_TIMEOUT_MS, TRANSCRIBE_MODEL, TRANSCRIBE_PATH } from '../common/models/models.consts';
import type { CompletionRequest, CompletionResult, ModelService, ProviderId, ProviderSettings, ProviderStatus, StreamPoll } from '../common/models/models.types';
import { buildProviderRequest, findModel, findProvider, parseProviderError, parseProviderResponse, parseStreamLine, redactSecrets, resolveModelName } from '../common/models/models.utils';
import type { CatalogModel, HttpRequestSpec, ProviderInfo } from '../common/models/models.types';

interface StreamState {
    chunks: string[];
    done: boolean;
    error?: string;
    controller: AbortController;
}

const STREAM_TTL_MS = 120_000;

/**
 * BYOK model gateway (IDEA-25/26). API keys live only in the OS keychain (via Theia's keytar-backed KeyStoreService)
 * and in memory while a request is sent. They are never written to files, logged or returned to the frontend.
 */
@injectable()
export class IngotModelService implements ModelService {

    @inject(KeyStoreService) protected readonly keyStore: KeyStoreService;

    protected readonly service = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;
    protected readonly streams = new Map<string, StreamState>();
    protected streamCounter = 0;

    async secureStorageAvailable(): Promise<boolean> {
        try {
            await this.keyStore.keys(this.service);
            return true;
        } catch {
            return false;
        }
    }

    async status(): Promise<ProviderStatus[]> {
        let stored: string[] = [];
        try {
            stored = await this.keyStore.keys(this.service);
        } catch {
            stored = [];
        }
        return PROVIDERS.map(p => ({ id: p.id, configured: !p.needsKey || stored.includes(p.id) }));
    }

    async setKey(provider: ProviderId, key: string): Promise<void> {
        const info = findProvider(provider);
        const value = key.trim();
        if (!info.needsKey || info.id !== provider || !value) {
            throw new Error('This provider does not take an API key.');
        }
        await this.keyStore.setPassword(this.service, provider, value);
    }

    async deleteKey(provider: ProviderId): Promise<void> {
        await this.keyStore.deletePassword(this.service, provider);
    }

    /** Transcribes dictation audio with the OpenAI key from the keychain; the key never leaves the backend. */
    async transcribe(audioBase64: string, mimeType: string): Promise<string> {
        const audio = Buffer.from(audioBase64, 'base64');
        if (!audio.length || audio.length > MAX_DICTATION_BYTES) {
            throw new Error('Recording is empty or too long.');
        }
        const key = await this.keyStore.getPassword(this.service, 'openai').catch(() => undefined);
        if (!key) {
            throw new Error('Voice dictation needs speech-to-text: sign in to Ingot or add an OpenAI key in Settings › Models.');
        }
        const form = new FormData();
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        form.append('file', new Blob([audio], { type: mimeType }), `dictation.${ext}`);
        form.append('model', TRANSCRIBE_MODEL);
        const response = await fetch(`${findProvider('openai').baseUrl}${TRANSCRIBE_PATH}`, {
            method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        const json = await response.json().catch(() => ({})) as { text?: string };
        if (!response.ok) {
            throw new Error(redactSecrets(parseProviderError(json) ?? `Transcription failed (${response.status}).`, [key]));
        }
        return String(json.text ?? '').trim();
    }

    protected async prepare(request: CompletionRequest, stream: boolean): Promise<{ model: CatalogModel; info: ProviderInfo; key?: string; name: string; spec: HttpRequestSpec }> {
        const model = findModel(request.modelId);
        if (!model) {
            throw new Error(`Unknown model "${request.modelId}".`);
        }
        const info = findProvider(model.provider);
        const key = info.needsKey ? await this.keyStore.getPassword(this.service, info.id) : undefined;
        if (info.needsKey && !key) {
            throw new Error(`No API key for ${model.label}. Add it in Settings › Models.`);
        }
        const name = resolveModelName(model, request.settings);
        return { model, info, key, name, spec: buildProviderRequest(info.id, name, request, key, stream) };
    }

    async complete(request: CompletionRequest): Promise<CompletionResult> {
        const { model, info, key, name, spec } = await this.prepare(request, false);
        try {
            const response = await fetch(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            const text = await response.text();
            const json = text ? JSON.parse(text) as unknown : {};
            if (!response.ok) {
                throw new Error(`${model.label} returned ${response.status}: ${parseProviderError(json) ?? response.statusText}`);
            }
            return { text: parseProviderResponse(info.id, json), model: name };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(redactSecrets(message, [key]));
        }
    }

    async startStream(request: CompletionRequest): Promise<string> {
        const prepared = await this.prepare(request, true);
        const id = `stream-${Date.now().toString(36)}-${this.streamCounter++}`;
        const state: StreamState = { chunks: [], done: false, controller: new AbortController() };
        this.streams.set(id, state);
        this.pump(state, prepared).finally(() => {
            state.done = true;
            setTimeout(() => this.streams.delete(id), STREAM_TTL_MS);
        });
        return id;
    }

    async pollStream(id: string, from: number): Promise<StreamPoll> {
        const state = this.streams.get(id);
        if (!state) {
            return { chunks: [], done: true, error: 'Stream not found.' };
        }
        return { chunks: state.chunks.slice(from), done: state.done, error: state.error };
    }

    async cancelStream(id: string): Promise<void> {
        this.streams.get(id)?.controller.abort();
    }

    protected async pump(state: StreamState, { model, info, key, spec }: { model: CatalogModel; info: ProviderInfo; key?: string; spec: HttpRequestSpec }): Promise<void> {
        try {
            const signal = AbortSignal.any([state.controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS * 5)]);
            const response = await fetch(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body), signal });
            if (!response.ok || !response.body) {
                const text = await response.text();
                let detail: string | undefined;
                try {
                    detail = parseProviderError(JSON.parse(text));
                } catch {
                    detail = undefined;
                }
                throw new Error(`${model.label} returned ${response.status}: ${detail ?? response.statusText}`);
            }
            const decoder = new TextDecoder();
            let buffer = '';
            const reader = response.body.getReader();
            for (;;) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const delta = parseStreamLine(info.id, line);
                    if (delta) {
                        state.chunks.push(delta);
                    }
                }
            }
            const last = parseStreamLine(info.id, buffer);
            if (last) {
                state.chunks.push(last);
            }
        } catch (error) {
            if (!state.controller.signal.aborted) {
                state.error = redactSecrets(error instanceof Error ? error.message : String(error), [key]);
            }
        }
    }

    /** Sends a one-word prompt to check a key / local server. */
    async test(provider: ProviderId, settings?: ProviderSettings): Promise<string> {
        const result = await this.complete({ modelId: TEST_MODELS[provider] ?? TEST_MODELS.openai, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 16, settings });
        return `Connected (${result.model})`;
    }
}

/** Model used by the Test button for each provider. */
const TEST_MODELS: Record<ProviderId, string> = {
    anthropic: 'claude-sonnet-4-5', openai: 'gpt-5-mini', gemini: 'gemini-2-5-pro', deepseek: 'deepseek-v3', openrouter: 'openrouter-auto', ollama: 'ollama-local'
};
