import { MODEL_CATALOG, MODEL_FAMILIES, PROVIDERS } from './models.consts';
import type { CatalogModel, ModelFamilyGroup, ChatImage, ChatMessage, CompletionRequest, HttpRequestSpec, ProviderId, ProviderInfo, ProviderSettings } from './models.types';

export const findModel = (id: string): CatalogModel | undefined => MODEL_CATALOG.find(m => m.id === id);
export const findProvider = (id: ProviderId): ProviderInfo => PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0];

/** Picker families with their models, in family order; families without models are left out (IDEA-91). */
export const groupModelsByFamily = (models: readonly CatalogModel[]): ModelFamilyGroup[] =>
    MODEL_FAMILIES.map(family => ({ family, models: models.filter(m => m.provider === family.provider) })).filter(g => g.models.length > 0);

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

/** Providers whose chat models read images (IDEA-98). DeepSeek's chat API is text only. */
export const VISION_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(['anthropic', 'openai', 'gemini', 'openrouter', 'ollama']);
export const supportsVision = (provider: ProviderId): boolean => VISION_PROVIDERS.has(provider);

const hasImages = (m: ChatMessage): boolean => !!m.images?.length;
const dataUrl = (i: ChatImage): string => `data:${i.mediaType};base64,${i.data}`;

/** Message content in each provider's shape: plain text, or text plus image parts. */
const anthropicContent = (m: ChatMessage): unknown => hasImages(m)
    ? [...m.images!.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text: m.content }]
    : m.content;
const geminiParts = (m: ChatMessage): unknown[] =>
    [...(m.images ?? []).map(i => ({ inline_data: { mime_type: i.mediaType, data: i.data } })), { text: m.content }];
const ollamaMessage = (m: ChatMessage): unknown => hasImages(m) ? { role: m.role, content: m.content, images: m.images!.map(i => i.data) } : { role: m.role, content: m.content };
const openAiMessage = (m: ChatMessage): unknown => hasImages(m)
    ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images!.map(i => ({ type: 'image_url', image_url: { url: dataUrl(i) } }))] }
    : { role: m.role, content: m.content };

/** Builds the HTTP request for a provider. Keys only go to the provider's fixed endpoint. */
export const buildProviderRequest = (provider: ProviderId, model: string, request: CompletionRequest, apiKey: string | undefined, stream = false): HttpRequestSpec => {
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
                body: { model, max_tokens: maxTokens, temperature, ...(stream ? { stream: true } : {}), ...(system ? { system } : {}), messages: rest.map(m => ({ role: m.role, content: anthropicContent(m) })), ...(stop ? { stop_sequences: stop } : {}) }
            };
        }
        case 'gemini': {
            const { system, rest } = splitSystem(request.messages);
            return {
                url: `${info.baseUrl}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
                headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey ?? '' },
                body: {
                    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
                    contents: rest.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m) })),
                    generationConfig: { maxOutputTokens: maxTokens, temperature, ...(stop ? { stopSequences: stop } : {}) }
                }
            };
        }
        case 'ollama':
            return {
                url: `${resolveOllamaUrl(request.settings)}/api/chat`,
                headers: { 'content-type': 'application/json' },
                body: { model, stream, messages: request.messages.map(ollamaMessage), options: { temperature, num_predict: maxTokens, ...(stop ? { stop } : {}) } }
            };
        default: {
            // OpenAI-compatible: OpenAI, DeepSeek, OpenRouter.
            const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${apiKey ?? ''}` };
            if (provider === 'openrouter') {
                headers['HTTP-Referer'] = 'https://github.com/yaghobieh/ingot';
                headers['X-Title'] = 'Ingot';
            }
            const tokens = provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature };
            return { url: `${info.baseUrl}/chat/completions`, headers, body: { model, messages: request.messages.map(openAiMessage), ...tokens, ...(stop ? { stop } : {}), ...(stream ? { stream: true } : {}) } };
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

/**
 * Extracts the text delta from one line of a streaming response: SSE `data:` lines for Anthropic, Gemini and
 * OpenAI-compatible providers, NDJSON for Ollama. Returns undefined for keep-alives, events and `[DONE]`.
 */
export const parseStreamLine = (provider: ProviderId, line: string): string | undefined => {
    const trimmed = line.trim();
    if (!trimmed) {
        return undefined;
    }
    let payload = trimmed;
    if (provider !== 'ollama') {
        if (!trimmed.startsWith('data:')) {
            return undefined;
        }
        payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
            return undefined;
        }
    }
    let json: unknown;
    try {
        json = JSON.parse(payload);
    } catch {
        return undefined;
    }
    const body = asObj(json);
    switch (provider) {
        case 'anthropic':
            return body.type === 'content_block_delta' ? String(asObj(body.delta).text ?? '') || undefined : undefined;
        case 'gemini':
            return parseProviderResponse('gemini', json) || undefined;
        case 'ollama':
            return String(asObj(body.message).content ?? '') || undefined;
        default:
            return String(asObj(asObj(asArr(body.choices)[0]).delta).content ?? '') || undefined;
    }
};
