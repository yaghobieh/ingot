import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { IngotAccountBackend } from './account/ingot-account-backend';
import { SIGN_IN_FOR_MODELS } from '../common/models/models.consts';
import { DEFAULT_KEYCHAIN_SERVICE, MAX_DICTATION_BYTES, PROVIDERS, REQUEST_TIMEOUT_MS, TRANSCRIBE_MODEL, TRANSCRIBE_PATH } from '../common/models/models.consts';
import type { CompletionRequest, CompletionResult, ModelService, ProviderId, ProviderSettings, ProviderStatus, StreamPoll } from '../common/models/models.types';
import { buildProviderRequest, findModel, findProvider, parseProviderError, parseProviderResponse, parseStreamEvent, redactSecrets, resolveModelName, toolCallsToProtocol } from '../common/models/models.utils';
import type { CatalogModel, HttpRequestSpec, ProviderInfo } from '../common/models/models.types';
import { encodeGatewayError, parseGatewayError } from '../common/account/gateway-errors';
import { ideHeaders } from '../common/account/gateway.utils';
import { PRODUCT } from '../common/product.consts';

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
    @inject(IngotAccountBackend) protected readonly account: IngotAccountBackend;

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
        const signedIn = (await this.account.snapshot().catch(() => undefined))?.signedIn ?? false;
        return PROVIDERS.map(p => ({ id: p.id, configured: p.id === 'ingot' ? signedIn : !p.needsKey || stored.includes(p.id) }));
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
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const token = await this.account.accessToken().catch(() => undefined);
        if (token) {
            // Signed in: Ingot's metered transcription endpoint (IDEA-101); no provider key needed.
            const form = new FormData();
            form.append('file', new Blob([audio], { type: mimeType }), `dictation.${ext}`);
            form.append('model', 'ingot-transcribe');
            const response = await fetch(`${this.account.gatewayBaseUrl}${TRANSCRIBE_PATH}`, {
                method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-ingot-feature': 'dictation' }, body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
            const json = await response.json().catch(() => ({})) as { text?: string };
            this.account.usageChanged();
            if (!response.ok) {
                throw new Error(redactSecrets(parseProviderError(json) ?? `Transcription failed (${response.status}).`, [token]));
            }
            return String(json.text ?? '').trim();
        }
        const key = await this.keyStore.getPassword(this.service, 'openai').catch(() => undefined);
        if (!key) {
            throw new Error('Voice dictation needs speech-to-text: sign in to Ingot or add an OpenAI key in Settings › Models.');
        }
        const form = new FormData();
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
        if (info.id === 'ingot') {
            const token = await this.account.accessToken().catch(() => undefined);
            if (!token) {
                throw new Error(`${SIGN_IN_FOR_MODELS}.`);
            }
            const settings = { ...request.settings, ingotBaseUrl: this.account.gatewayBaseUrl };
            const spec = buildProviderRequest('ingot', model.model, { ...request, settings }, token, stream);
            return { model, info, key: token, name: model.model, spec: { ...spec, headers: { ...spec.headers, ...ideHeaders(PRODUCT.version) } } };
        }
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
                await this.throwGatewayError(info, response, json);
                throw new Error(`${model.label} returned ${response.status}: ${parseProviderError(json) ?? response.statusText}`);
            }
            return { text: parseProviderResponse(info.id, json), model: name };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(redactSecrets(message, [key]));
        } finally {
            if (info.id === 'ingot') {
                this.account.usageChanged();
            }
        }
    }

    async startStream(request: CompletionRequest): Promise<string> {
        const prepared = await this.prepare(request, true);
        const id = `stream-${Date.now().toString(36)}-${this.streamCounter++}`;
        const state: StreamState = { chunks: [], done: false, controller: new AbortController() };
        this.streams.set(id, state);
        this.pump(state, prepared).finally(() => {
            state.done = true;
            if (prepared.info.id === 'ingot') {
                this.account.usageChanged();
            }
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
                let json: unknown;
                try {
                    json = JSON.parse(text);
                    detail = parseProviderError(json);
                } catch {
                    detail = undefined;
                }
                await this.throwGatewayError(info, response, json);
                throw new Error(`${model.label} returned ${response.status}: ${detail ?? response.statusText}`);
            }
            const decoder = new TextDecoder();
            let buffer = '';
            const calls = new Map<number, { name: string; arguments: string }>();
            const take = (line: string): void => {
                const event = parseStreamEvent(info.id, line);
                if (!event) {
                    return;
                }
                if (event.content) {
                    state.chunks.push(event.content);
                }
                for (const delta of event.toolDeltas ?? []) {
                    const current = calls.get(delta.index) ?? { name: '', arguments: '' };
                    calls.set(delta.index, {
                        name: delta.name ?? current.name,
                        arguments: current.arguments + (delta.arguments ?? '')
                    });
                }
            };
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
                    take(line);
                }
            }
            take(buffer);
            const protocol = toolCallsToProtocol([...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call));
            if (protocol) {
                state.chunks.push(protocol);
            }
        } catch (error) {
            if (!state.controller.signal.aborted) {
                state.error = redactSecrets(error instanceof Error ? error.message : String(error), [key]);
            }
        }
    }

    /** Ingot gateway errors keep their code (IDEA-124) so the chat can count down, fall back or show the blocked screen. */
    protected async throwGatewayError(info: ProviderInfo, response: Response, json: unknown): Promise<void> {
        if (info.id !== 'ingot') {
            return;
        }
        const error = parseGatewayError(response.status, json, response.headers.get('retry-after'));
        if (!error) {
            return;
        }
        if (error.kind === 'blocked') {
            await this.account.markBlocked();
        }
        throw new Error(encodeGatewayError(error));
    }

    /** Sends a one-word prompt to check a key / local server. */
    async test(provider: ProviderId, settings?: ProviderSettings): Promise<string> {
        const result = await this.complete({ modelId: TEST_MODELS[provider] ?? TEST_MODELS.openai, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 16, settings });
        return `Connected (${result.model})`;
    }
}

/** Model used by the Test button for each provider. */
const TEST_MODELS: Record<ProviderId, string> = {
    ingot: 'ingot:ingot-fast', anthropic: 'claude-sonnet-4-5', openai: 'gpt-5-mini', gemini: 'gemini-2-5-pro', deepseek: 'deepseek-v3', openrouter: 'openrouter-auto', ollama: 'ollama-local'
};
