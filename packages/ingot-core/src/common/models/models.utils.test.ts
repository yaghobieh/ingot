import { describe, expect, it } from 'vitest';
import { parseStreamEvent, parseStreamLine, toolCallsToProtocol, buildProviderRequest, parseProviderError, parseProviderResponse, redactSecrets, resolveModelName, resolveOllamaUrl, findModel, groupModelsByFamily, supportsVision } from './models.utils';
import { MODEL_CATALOG } from './models.consts';
import type { CompletionRequest } from './models.types';

const request: CompletionRequest = { modelId: 'x', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], maxTokens: 10 };
const KEY = 'test-key-not-real-123456';

describe('provider requests', () => {
    it('builds Anthropic requests with the key header and a separate system prompt', () => {
        const spec = buildProviderRequest('anthropic', 'claude-sonnet-4-5', request, KEY);
        expect(spec.url).toBe('https://api.anthropic.com/v1/messages');
        expect(spec.headers['x-api-key']).toBe(KEY);
        expect(spec.body).toMatchObject({ model: 'claude-sonnet-4-5', system: 'sys', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    });

    it('builds OpenAI-compatible requests for OpenAI, DeepSeek and OpenRouter', () => {
        expect(buildProviderRequest('openai', 'gpt-5', request, KEY)).toMatchObject({ url: 'https://api.openai.com/v1/chat/completions', headers: { authorization: `Bearer ${KEY}` }, body: { max_completion_tokens: 10 } });
        expect(buildProviderRequest('deepseek', 'deepseek-chat', request, KEY).url).toBe('https://api.deepseek.com/chat/completions');
        const router = buildProviderRequest('openrouter', 'openrouter/auto', request, KEY);
        expect(router.url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(router.headers['X-Title']).toBe('Ingot');
    });

    it('builds Gemini requests with model role mapping', () => {
        const spec = buildProviderRequest('gemini', 'gemini-2.5-pro', { ...request, messages: [...request.messages, { role: 'assistant', content: 'yo' }] }, KEY);
        expect(spec.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
        expect(spec.headers['x-goog-api-key']).toBe(KEY);
        expect(spec.body).toMatchObject({ systemInstruction: { parts: [{ text: 'sys' }] }, contents: [{ role: 'user' }, { role: 'model' }] });
    });

    it('sends Ollama requests to the configured local URL without a key', () => {
        const spec = buildProviderRequest('ollama', 'qwen2.5-coder', { ...request, settings: { ollamaBaseUrl: 'http://127.0.0.1:5000/' } }, undefined);
        expect(spec.url).toBe('http://127.0.0.1:5000/api/chat');
        expect(JSON.stringify(spec.headers)).not.toMatch(/auth|key/i);
        expect(resolveOllamaUrl({ ollamaBaseUrl: 'javascript:alert(1)' })).toBe('http://127.0.0.1:11434');
    });

    it('applies per-provider model overrides', () => {
        const model = findModel('ollama-local')!;
        expect(resolveModelName(model)).toBe('qwen2.5-coder');
        expect(resolveModelName(model, { modelOverrides: { ollama: 'llama3.2' } })).toBe('llama3.2');
    });
});

describe('provider responses', () => {
    it('parses each provider format', () => {
        expect(parseProviderResponse('anthropic', { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab');
        expect(parseProviderResponse('openai', { choices: [{ message: { content: 'c' } }] })).toBe('c');
        expect(parseProviderResponse('gemini', { candidates: [{ content: { parts: [{ text: 'g' }] } }] })).toBe('g');
        expect(parseProviderResponse('ollama', { message: { content: 'o' } })).toBe('o');
        expect(parseProviderResponse('openai', {})).toBe('');
    });

    it('parses error bodies', () => {
        expect(parseProviderError({ error: { message: 'bad key' } })).toBe('bad key');
        expect(parseProviderError({ error: 'model not found' })).toBe('model not found');
        expect(parseProviderError('x')).toBeUndefined();
    });
});

describe('safety and completions', () => {
    it('redacts keys from error messages', () => {
        // Built at runtime so the repository secret scan does not flag test fixtures.
        const looksLikeKey = ['sk', 'abcdefghijklmnopqrstuv'].join('-');
        const out = redactSecrets(`401 for ${KEY} and Bearer abcdefghijklmnop and ${looksLikeKey}`, [KEY]);
        expect(out).not.toContain(KEY);
        expect(out).not.toContain('abcdefghijklmnop');
        expect(out).not.toContain(looksLikeKey);
    });
});

describe('streaming', () => {
    it('parses stream lines for every provider', () => {
        expect(parseStreamLine('openai', 'data: {"choices":[{"delta":{"content":"Hel"}}]}')).toBe('Hel');
        expect(parseStreamLine('deepseek', 'data: [DONE]')).toBeUndefined();
        expect(parseStreamLine('anthropic', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}')).toBe('lo');
        expect(parseStreamLine('anthropic', 'event: ping')).toBeUndefined();
        expect(parseStreamLine('gemini', 'data: {"candidates":[{"content":{"parts":[{"text":"g"}]}}]}')).toBe('g');
        expect(parseStreamLine('ollama', '{"message":{"content":"o"},"done":false}')).toBe('o');
        expect(parseStreamLine('ollama', '{"done":true}')).toBeUndefined();
        const call = 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"create_library","arguments":"{\\"path\\":\\"/tmp/x\\"}"}}]}}]}';
        expect(parseStreamLine('ingot', call)).toBeUndefined();
        expect(parseStreamEvent('ingot', call)?.toolDeltas?.[0]).toMatchObject({ index: 0, name: 'create_library' });
        expect(toolCallsToProtocol([{ name: 'create_library', arguments: '{"path":"/tmp/x"}' }])).toContain('<<<TOOL ingot/create_library');
    });

    it('sends the system prompt and tool definitions to the Ingot gateway', () => {
        const spec = buildProviderRequest('ingot', 'ingot-fast', {
            ...request, tools: [{ name: 'create_library', description: 'Create a project' }], settings: { ingotBaseUrl: 'http://127.0.0.1:3300/v1/' }
        }, KEY, true);
        expect(spec.url).toBe('http://127.0.0.1:3300/v1/chat/completions');
        expect(spec.body).toMatchObject({
            messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
            tool_choice: 'auto', stream: true
        });
        expect(JSON.stringify(spec.body)).toContain('"name":"create_library"');
        const plain = buildProviderRequest('ingot', 'ingot-fast', request, KEY);
        expect(JSON.stringify(plain.body)).not.toContain('tool_choice');
    });

    it('asks providers to stream', () => {
        expect(buildProviderRequest('gemini', 'g', request, KEY, true).url).toContain(':streamGenerateContent?alt=sse');
        expect(buildProviderRequest('openai', 'gpt-5', request, KEY, true).body).toMatchObject({ stream: true });
        expect(buildProviderRequest('ollama', 'q', request, undefined, true).body).toMatchObject({ stream: true });
        expect(buildProviderRequest('anthropic', 'c', request, KEY, true).body).toMatchObject({ stream: true });
    });
});

describe('model families (IDEA-91)', () => {
    it('groups the catalog by family in picker order and drops empty families', () => {
        const groups = groupModelsByFamily(MODEL_CATALOG);
        expect(groups.map(g => g.family.label)).toEqual(['Claude', 'GPT', 'Gemini', 'DeepSeek', 'Routed', 'Local']);
        expect(groups[0].models.map(m => m.id)).toEqual(['claude-sonnet-4-5', 'claude-opus-4-1']);
        expect(groupModelsByFamily(MODEL_CATALOG.filter(m => m.provider === 'openai')).map(g => g.family.label)).toEqual(['GPT']);
    });
});

describe('image parts (IDEA-98)', () => {
    const image = { mediaType: 'image/png', data: 'iVBOR' };
    const request = { modelId: 'x', messages: [{ role: 'user' as const, content: 'what is this?', images: [image] }] };
    const body = (provider: Parameters<typeof buildProviderRequest>[0]) => JSON.stringify(buildProviderRequest(provider, 'm', request, 'k').body);

    it('sends images in each provider\'s shape', () => {
        expect(body('anthropic')).toContain('"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBOR"}');
        expect(body('gemini')).toContain('"inline_data":{"mime_type":"image/png","data":"iVBOR"}');
        expect(body('ollama')).toContain('"images":["iVBOR"]');
        expect(body('openai')).toContain('"image_url":{"url":"data:image/png;base64,iVBOR"}');
        expect(body('openrouter')).toContain('"type":"text","text":"what is this?"');
    });

    it('keeps text-only messages as plain strings and knows which providers read images', () => {
        const plain = JSON.stringify(buildProviderRequest('openai', 'm', { modelId: 'x', messages: [{ role: 'user', content: 'hi' }] }, 'k').body);
        expect(plain).toContain('"content":"hi"');
        expect(supportsVision('anthropic')).toBe(true);
        expect(supportsVision('deepseek')).toBe(false);
    });
});
