import { MODEL_CATALOG, PROVIDERS } from './models.consts';
import type { CatalogModel, ChatMessage, CompletionRequest, HttpRequestSpec, ProviderId, ProviderInfo, ProviderSettings } from './models.types';

export const findModel = (id: string): CatalogModel | undefined => MODEL_CATALOG.find(m => m.id === id);
export const findProvider = (id: ProviderId): ProviderInfo => PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0];

export const resolveModelName = (model: CatalogModel, settings?: ProviderSettings): string =>
    settings?.modelOverrides?.[model.provider]?.trim() || model.model;

/** Only http(s) on any host for Ollama (it never receives a key). */
export const resolveOllamaUrl = (settings?: ProviderSettings): string => {
    const url = settings?.ollamaBaseUrl?.trim();
    return url && /^https?:\/\/[^\s]+$/.test(url) ? url.replace(/\/+$/, '') : findProvider('ollama').baseUrl;
};

const splitSystem = (messages: readonly ChatMessage[]): { system: string; rest: ChatMessage[] } => ({
    system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    rest: messages.filter(m => m.role !== 'system')
});

/** Builds the HTTP request for a provider. Keys only go to the provider's fixed endpoint. */
export const buildProviderRequest = (provider: ProviderId, model: string, request: CompletionRequest, apiKey: string | undefined): HttpRequestSpec => {
    const maxTokens = request.maxTokens ?? 2048;
    const temperature = request.temperature ?? 0.2;
    const stop = request.stop?.length ? [...request.stop] : undefined;
    const info = findProvider(provider);
    switch (provider) {
        case 'anthropic': {
            const { system, rest } = splitSystem(request.messages);
            return {
                url: `${info.baseUrl}/messages`,
                headers: { 'content-type': 'application/json', 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
                body: { model, max_tokens: maxTokens, temperature, ...(system ? { system } : {}), messages: rest.map(m => ({ role: m.role, content: m.content })), ...(stop ? { stop_sequences: stop } : {}) }
            };
        }
        case 'gemini': {
            const { system, rest } = splitSystem(request.messages);
            return {
                url: `${info.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
                headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey ?? '' },
                body: {
                    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
                    contents: rest.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
                    generationConfig: { maxOutputTokens: maxTokens, temperature, ...(stop ? { stopSequences: stop } : {}) }
                }
            };
        }
        case 'ollama':
            return {
                url: `${resolveOllamaUrl(request.settings)}/api/chat`,
                headers: { 'content-type': 'application/json' },
                body: { model, stream: false, messages: request.messages, options: { temperature, num_predict: maxTokens, ...(stop ? { stop } : {}) } }
            };
        default: {
            // OpenAI-compatible: OpenAI, DeepSeek, OpenRouter.
            const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${apiKey ?? ''}` };
            if (provider === 'openrouter') {
                headers['HTTP-Referer'] = 'https://github.com/yaghobieh/ingot';
                headers['X-Title'] = 'Ingot';
            }
            const tokens = provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature };
            return { url: `${info.baseUrl}/chat/completions`, headers, body: { model, messages: request.messages, ...tokens, ...(stop ? { stop } : {}) } };
        }
    }
};

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Extracts the reply text from a provider response body. */
export const parseProviderResponse = (provider: ProviderId, json: unknown): string => {
    const body = asObj(json);
    switch (provider) {
        case 'anthropic':
            return asArr(body.content).map(asObj).filter(c => c.type === 'text').map(c => String(c.text ?? '')).join('');
        case 'gemini':
            return asArr(asObj(asObj(asArr(body.candidates)[0]).content).parts).map(p => String(asObj(p).text ?? '')).join('');
        case 'ollama':
            return String(asObj(body.message).content ?? '');
        default:
            return String(asObj(asObj(asArr(body.choices)[0]).message).content ?? '');
    }
};

/** Pulls a readable error message out of a provider error body. */
export const parseProviderError = (json: unknown): string | undefined => {
    const body = asObj(json);
    const error = body.error;
    if (typeof error === 'string') {
        return error;
    }
    const message = asObj(error).message ?? body.message;
    return typeof message === 'string' ? message : undefined;
};

/** Removes every occurrence of the given secrets (and anything that looks like a bearer token) from a message. */
export const redactSecrets = (text: string, secrets: readonly (string | undefined)[]): string => {
    let out = text;
    for (const secret of secrets) {
        if (secret && secret.length >= 4) {
            out = out.split(secret).join('[redacted]');
        }
    }
    return out.replace(/(Bearer\s+)[\w.-]{8,}/gi, '$1[redacted]').replace(/\b(sk-[\w-]{6})[\w-]{6,}/g, '$1…[redacted]');
};

/** Strips markdown fences and a repeated prefix from a completion. */
export const cleanCompletion = (text: string, linePrefix = ''): string => {
    let out = text.replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '');
    if (linePrefix.trim() && out.startsWith(linePrefix)) {
        out = out.slice(linePrefix.length);
    }
    return out.replace(/<CURSOR>/g, '');
};

/** Prompt for inline completion: the code around the cursor with a <CURSOR> marker. */
export const buildCompletionMessages = (prefix: string, suffix: string, language: string, systemPrompt: string): ChatMessage[] => [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Language: ${language}\n\n${prefix}<CURSOR>${suffix}` }
];
