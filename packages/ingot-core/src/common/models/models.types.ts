export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'openrouter' | 'ollama';

export interface ProviderInfo {
    readonly id: ProviderId;
    readonly label: string;
    /** Local providers (Ollama) need no key. */
    readonly needsKey: boolean;
    /** Fixed endpoint; keys are only ever sent here. Ollama's endpoint is user-configurable because it carries no key. */
    readonly baseUrl: string;
    readonly keyHint: string;
}

/** A model family row in the picker; its `>` submenu lists the family's models (IDEA-91). */
export interface ModelFamily {
    readonly provider: ProviderId;
    /** Family name as shown to the user (model naming only, never a company name). */
    readonly label: string;
    readonly icon: string;
}

export interface ModelFamilyGroup {
    readonly family: ModelFamily;
    readonly models: readonly CatalogModel[];
}

export interface CatalogModel {
    /** Stable id used by the picker and preferences. */
    readonly id: string;
    readonly label: string;
    readonly provider: ProviderId;
    /** Provider-side model name; can be overridden per provider in Settings › Models. */
    readonly model: string;
    /** Picker badges (IDEA-77). */
    readonly speed: 'fast' | 'balanced' | 'slow';
    readonly cost: 'free' | '$' | '$$' | '$$$';
    /** Context window in tokens. */
    readonly contextWindow: number;
    readonly thinking: boolean;
    readonly recommended: boolean;
}

export interface ChatMessage {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
}

export interface CompletionRequest {
    readonly modelId: string;
    readonly messages: readonly ChatMessage[];
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly stop?: readonly string[];
    /** Non-secret per-provider settings from preferences (Ollama URL, model overrides). */
    readonly settings?: ProviderSettings;
}

export interface ProviderSettings {
    readonly ollamaBaseUrl?: string;
    readonly modelOverrides?: Partial<Record<ProviderId, string>>;
}

export interface StreamPoll {
    readonly chunks: readonly string[];
    readonly done: boolean;
    readonly error?: string;
}

export interface CompletionResult {
    readonly text: string;
    readonly model: string;
}

export interface ProviderStatus {
    readonly id: ProviderId;
    readonly configured: boolean;
}

export interface HttpRequestSpec {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: unknown;
}

export const ModelService = Symbol('IngotModelService');

/** Backend service. API keys go in and are stored in the OS keychain; they never come back out. */
export interface ModelService {
    secureStorageAvailable(): Promise<boolean>;
    status(): Promise<ProviderStatus[]>;
    setKey(provider: ProviderId, key: string): Promise<void>;
    deleteKey(provider: ProviderId): Promise<void>;
    complete(request: CompletionRequest): Promise<CompletionResult>;
    test(provider: ProviderId, settings?: ProviderSettings): Promise<string>;
    /** Starts a streaming completion; poll for chunks with `pollStream` (RPC-friendly streaming). */
    startStream(request: CompletionRequest): Promise<string>;
    pollStream(id: string, from: number): Promise<StreamPoll>;
    cancelStream(id: string): Promise<void>;
}
