import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { MODEL_CATALOG, MODEL_PREFERENCES } from '../../common/models/models.consts';
import { ModelService, type ChatMessage, type CompletionResult, type ProviderId, type ProviderSettings, type ProviderStatus } from '../../common/models/models.types';
import { findModel } from '../../common/models/models.utils';

/** Preferred order when picking a model automatically for inline completion (fast/cheap first). */
const STREAM_POLL_MS = 80;
const AUTOCOMPLETE_ORDER = ['ollama-local', 'gpt-5-mini', 'deepseek-v3', 'claude-sonnet-4-5', 'gemini-2-5-pro', 'openrouter-auto', 'gpt-5', 'claude-opus-4-1'];

/** Frontend view of the BYOK model gateway; only ever sees "configured" flags, never keys. */
@injectable()
export class IngotModelClient {

    @inject(ModelService) protected readonly service: ModelService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected statuses: ProviderStatus[] = [];
    secureStorage = true;

    @postConstruct()
    protected init(): void {
        this.refresh();
    }

    async refresh(): Promise<void> {
        try {
            const [secure, statuses] = await Promise.all([this.service.secureStorageAvailable(), this.service.status()]);
            this.secureStorage = secure;
            this.statuses = statuses;
        } catch {
            this.statuses = [];
        }
        this.onDidChangeEmitter.fire();
    }

    isProviderConfigured(provider: ProviderId): boolean {
        return this.statuses.some(s => s.id === provider && s.configured);
    }

    isModelConfigured(modelId: string): boolean {
        const model = findModel(modelId);
        return !!model && this.isProviderConfigured(model.provider);
    }

    get settings(): ProviderSettings {
        return {
            ollamaBaseUrl: this.preferences.get<string>(MODEL_PREFERENCES.ollamaUrl),
            modelOverrides: this.preferences.get<Partial<Record<ProviderId, string>>>(MODEL_PREFERENCES.overrides, {})
        };
    }

    /** Model for inline completion: the preference, else the first connected one (local Ollama only when explicitly chosen). */
    get autocompleteModel(): string | undefined {
        const chosen = this.preferences.get<string>(MODEL_PREFERENCES.autocompleteModel, '');
        if (chosen) {
            return chosen;
        }
        return AUTOCOMPLETE_ORDER.filter(id => id !== 'ollama-local').find(id => this.isModelConfigured(id));
    }

    async setKey(provider: ProviderId, key: string): Promise<void> {
        await this.service.setKey(provider, key);
        await this.refresh();
    }

    async deleteKey(provider: ProviderId): Promise<void> {
        await this.service.deleteKey(provider);
        await this.refresh();
    }

    test(provider: ProviderId): Promise<string> {
        return this.service.test(provider, this.settings);
    }

    complete(modelId: string, messages: ChatMessage[], options: { maxTokens?: number; temperature?: number; stop?: string[] } = {}): Promise<CompletionResult> {
        return this.service.complete({ modelId, messages, ...options, settings: this.settings });
    }

    /**
     * Streams a completion; `onText` receives the accumulated text. Resolves with the full text,
     * rejects on provider errors. Call the returned `cancel` to stop early.
     */
    stream(modelId: string, messages: ChatMessage[], onText: (text: string) => void): { done: Promise<string>; cancel: () => void } {
        let cancelled = false;
        let streamId: string | undefined;
        const done = (async () => {
            streamId = await this.service.startStream({ modelId, messages, settings: this.settings });
            let text = '';
            let received = 0;
            for (;;) {
                const poll = await this.service.pollStream(streamId, received);
                if (poll.chunks.length) {
                    received += poll.chunks.length;
                    text += poll.chunks.join('');
                    onText(text);
                }
                if (poll.error) {
                    throw new Error(poll.error);
                }
                if (poll.done || cancelled) {
                    return text;
                }
                await new Promise(resolve => setTimeout(resolve, STREAM_POLL_MS));
            }
        })();
        return { done, cancel: () => { cancelled = true; if (streamId) { this.service.cancelStream(streamId); } } };
    }

    get catalog(): typeof MODEL_CATALOG {
        return MODEL_CATALOG;
    }
}
