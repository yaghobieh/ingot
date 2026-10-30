import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { BYOK_PROVIDERS, MODEL_CATALOG, MODEL_PREFERENCES } from '../../common/models/models.consts';
import type { CatalogModel } from '../../common/models/models.types';
import { IngotAccountService } from '../account/account-service';
import { UNAVAILABLE_MODEL_HINT, defaultGatewayModel, ingotModelId, toCatalogModel } from '../../common/account/gateway.utils';
import type { GatewayModelInfo } from '../../common/account/account-protocol';
import { ModelService, type ChatMessage, type CompletionResult, type ProviderId, type ProviderSettings, type ProviderStatus } from '../../common/models/models.types';
import { findModel, getGatewayModels, setGatewayModels } from '../../common/models/models.utils';

/** Preferred order when picking a model automatically for inline completion (fast/cheap first). */
const STREAM_POLL_MS = 80;
const AUTOCOMPLETE_ORDER = ['ingot:ingot-fast', 'ollama-local', 'gpt-5-mini', 'deepseek-v3', 'claude-sonnet-4-5', 'gemini-2-5-pro', 'openrouter-auto', 'gpt-5', 'claude-opus-4-1'];

/** Frontend view of the BYOK model gateway; only ever sees "configured" flags, never keys. */
@injectable()
export class IngotModelClient {

    @inject(ModelService) protected readonly service: ModelService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;

    /** Gateway model ids the server says are available (provider key present upstream). */
    protected available = new Set<string>();
    /** Gateway rows by picker id (IDEA-124): order, default and why a model is unavailable. */
    protected gateway = new Map<string, GatewayModelInfo>();
    protected gatewayDefault?: string;
    protected signedIn = false;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected statuses: ProviderStatus[] = [];
    secureStorage = true;

    @postConstruct()
    protected init(): void {
        this.refresh();
        this.account.onDidChange(() => {
            if (this.account.signedIn !== this.signedIn) {
                this.signedIn = this.account.signedIn;
                this.refresh();
            }
        });
        this.preferences.onPreferenceChanged(e => e.preferenceName === MODEL_PREFERENCES.byok && this.onDidChangeEmitter.fire());
    }

    /** BYOK / Local providers are opt-in (IDEA-101). */
    get byok(): boolean {
        return this.preferences.get<boolean>(MODEL_PREFERENCES.byok, false);
    }

    protected async refreshGatewayModels(): Promise<void> {
        const models = await this.account.models().catch(() => []);
        setGatewayModels(models.map(toCatalogModel));
        this.available = new Set(models.filter(m => m.available).map(m => ingotModelId(m.id)));
        this.gateway = new Map(models.map(m => [ingotModelId(m.id), m]));
        const fallback = defaultGatewayModel(models);
        this.gatewayDefault = fallback ? ingotModelId(fallback.id) : undefined;
    }

    /** Re-fetch /v1/models (after model_* errors, plan or config changes). */
    async refreshModels(): Promise<void> {
        await this.refreshGatewayModels();
        this.onDidChangeEmitter.fire();
    }

    /** The server's default model (or the first that can run), as a picker id. */
    get defaultModel(): string | undefined {
        return this.gatewayDefault;
    }

    /** True once /v1/models returned a list for the signed-in account. */
    get gatewayLoaded(): boolean {
        return this.gateway.size > 0;
    }

    /** A saved Ingot model that is gone from the list or cannot run right now. */
    isGatewayModelGone(id: string): boolean {
        return id.startsWith('ingot:') && this.gatewayLoaded && !this.available.has(id);
    }

    /** Tooltip for a greyed-out Ingot model; undefined when it can run. */
    unavailableReason(id: string): string | undefined {
        const row = this.gateway.get(id);
        return row && !row.available ? row.reason || UNAVAILABLE_MODEL_HINT : undefined;
    }

    get portalUrl(): string {
        return this.account.urls.portalUrl;
    }

    label(id: string): string {
        return findModel(id)?.label ?? id;
    }

    async refresh(): Promise<void> {
        try {
            const [secure, statuses] = await Promise.all([this.service.secureStorageAvailable(), this.service.status(), this.refreshGatewayModels()]);
            this.secureStorage = secure;
            this.statuses = statuses;
        } catch {
            this.statuses = [];
        }
        this.onDidChangeEmitter.fire();
    }

    isProviderConfigured(provider: ProviderId): boolean {
        if (provider === 'ingot') {
            // The account snapshot is the source of truth; a provider status fetched mid sign-in can be stale.
            return this.account.signedIn;
        }
        return this.statuses.some(s => s.id === provider && s.configured);
    }

    isModelConfigured(modelId: string): boolean {
        const model = findModel(modelId);
        if (!model) {
            return false;
        }
        if (model.provider === 'ingot') {
            return this.isProviderConfigured('ingot') && (this.available.size === 0 || this.available.has(model.id));
        }
        return this.byok && this.isProviderConfigured(model.provider);
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

    transcribe(audioBase64: string, mimeType: string): Promise<string> {
        return this.service.transcribe(audioBase64, mimeType);
    }

    /** `feature` tags gateway usage; `modelOverrides` swap a provider's model for this request only. */
    complete(modelId: string, messages: ChatMessage[], options: {
        maxTokens?: number; temperature?: number; stop?: string[]; feature?: string; modelOverrides?: Partial<Record<ProviderId, string>>
    } = {}): Promise<CompletionResult> {
        const { feature, modelOverrides, ...limits } = options;
        const base = this.settings;
        const settings: ProviderSettings = {
            ...base,
            ...(feature ? { feature } : {}),
            ...(modelOverrides ? { modelOverrides: { ...base.modelOverrides, ...modelOverrides } } : {})
        };
        return this.service.complete({ modelId, messages, ...limits, settings });
    }

    /**
     * Streams a completion; `onText` receives the accumulated text. Resolves with the full text,
     * rejects on provider errors. Call the returned `cancel` to stop early.
     */
    stream(modelId: string, messages: ChatMessage[], onText: (text: string) => void,
        options: { feature?: string; maxTokens?: number; temperature?: number; tools?: { name: string; description: string }[] } = {}): { done: Promise<string>; cancel: () => void } {
        let cancelled = false;
        let streamId: string | undefined;
        const { feature, tools, ...limits } = options;
        const done = (async () => {
            streamId = await this.service.startStream({ modelId, messages, ...limits, ...(tools?.length ? { tools } : {}), settings: feature ? { ...this.settings, feature } : this.settings });
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

    /** Picker models: Ingot models first (signed in), then BYOK / Local when that is turned on. */
    get catalog(): readonly CatalogModel[] {
        const own = this.byok ? MODEL_CATALOG.filter(m => BYOK_PROVIDERS.includes(m.provider)) : [];
        return [...getGatewayModels(), ...own];
    }
}
