import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmbeddingProvider, LocalEmbeddingProvider, OllamaEmbeddingProvider } from './embedding-providers';
import { dot } from '../../common/codebase-index/codebase-index.utils';

const serve = async (handler: (body: { model: string; input: string[] }) => { status: number; json: unknown }): Promise<{ url: string; close: () => Promise<void> }> => {
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const reply = req.url === '/api/embed' ? handler(JSON.parse(raw)) : { status: 404, json: {} };
            res.writeHead(reply.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(reply.json));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => new Promise(resolve => server.close(() => resolve())) };
};

describe('IDEA-260 embedding providers', () => {
    let close: (() => Promise<void>) | undefined;
    afterEach(async () => {
        await close?.();
        close = undefined;
    });

    it('picks the provider from settings; each provider names its own vector space', () => {
        expect(createEmbeddingProvider({ provider: 'local' })).toBeInstanceOf(LocalEmbeddingProvider);
        const ollama = createEmbeddingProvider({ provider: 'ollama', ollamaModel: 'all-minilm' });
        expect(ollama).toBeInstanceOf(OllamaEmbeddingProvider);
        expect(ollama.key).toBe('ollama:all-minilm');
        expect(ollama.key).not.toBe(new LocalEmbeddingProvider().key);
    });

    it('sends a batch to Ollama /api/embed and returns unit vectors', async () => {
        const seen: { model: string; input: string[] }[] = [];
        const server = await serve(body => {
            seen.push(body);
            return { status: 200, json: { embeddings: body.input.map((_, i) => [3, 4 * (i + 1)]) } };
        });
        close = server.close;
        const vectors = await new OllamaEmbeddingProvider(server.url, 'nomic-embed-text').embed(['a', 'b']);
        expect(seen).toEqual([{ model: 'nomic-embed-text', input: ['a', 'b'] }]);
        expect(vectors).toHaveLength(2);
        expect(dot(vectors[0], vectors[0])).toBeCloseTo(1);
    });

    it('reports Ollama errors', async () => {
        const server = await serve(() => ({ status: 404, json: { error: 'model "nope" not found' } }));
        close = server.close;
        await expect(new OllamaEmbeddingProvider(server.url, 'nope').embed(['a'])).rejects.toThrow('Ollama: model "nope" not found');
    });
});
