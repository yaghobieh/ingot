import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { DEFAULT_KEYCHAIN_SERVICE, PROVIDERS, REQUEST_TIMEOUT_MS } from '../common/models/models.consts';
import type { CompletionRequest, CompletionResult, ModelService, ProviderId, ProviderSettings, ProviderStatus } from '../common/models/models.types';
import { buildProviderRequest, findModel, findProvider, parseProviderError, parseProviderResponse, redactSecrets, resolveModelName } from '../common/models/models.utils';

/**
 * BYOK model gateway (IDEA-25/26). API keys live only in the OS keychain (via Theia's keytar-backed KeyStoreService)
 * and in memory while a request is sent. They are never written to files, logged or returned to the frontend.
 */
@injectable()
export class IngotModelService implements ModelService {

    @inject(KeyStoreService) protected readonly keyStore: KeyStoreService;

    protected readonly service = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;

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

    async complete(request: CompletionRequest): Promise<CompletionResult> {
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
        const spec = buildProviderRequest(info.id, name, request, key);
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
