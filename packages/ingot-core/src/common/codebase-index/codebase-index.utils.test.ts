import { describe, expect, it } from 'vitest';
import {
    chunkText, clampLimit, dot, dropOverlaps, formatSearchResult, hashEmbed, indexStatusView, LruCache, rankCandidates, snippetWindow, tokenize, underPath
} from './codebase-index.utils';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from './codebase-index.consts';
import type { IndexStatus } from './codebase-index.types';

const status: IndexStatus = { root: '/p', state: 'ready', files: 3, chunks: 7, done: 3, total: 3, embedded: 2, reused: 5, provider: 'local' };

describe('IDEA-260 codebase index utils', () => {
    it('splits identifiers into stemmed words and drops stop words', () => {
        expect(tokenize('export const roundPrice = (prices) => total_amount;')).toEqual(['roundprice', 'round', 'price', 'price', 'total_amount', 'total', 'amount']);
        expect(tokenize('where are the prices rounded?')).toEqual(['price', 'round']);
    });

    it('embeds related code closer than unrelated code', () => {
        const query = hashEmbed('where are prices rounded');
        const pricing = hashEmbed('export const roundPrice = (price: number) => Math.round(price * 100) / 100;');
        const auth = hashEmbed('export const login = async (user: string, password: string) => session.start(user);');
        expect(dot(query, query)).toBeCloseTo(1);
        expect(dot(query, pricing)).toBeGreaterThan(dot(query, auth));
    });

    it('chunks text into overlapping line windows and skips blank ones', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
        const chunks = chunkText(text, 40, 8);
        expect(chunks.map(c => [c.startLine, c.endLine])).toEqual([[1, 40], [33, 72], [65, 100]]);
        expect(chunkText('\n\n  \n')).toEqual([]);
    });

    it('ranks by cosine plus query words in the text or path, and drops overlapping hits', () => {
        const ranked = rankCandidates('round price', [
            { path: 'src/auth.ts', text: 'login user', cosine: 0.3 },
            { path: 'src/pricing.ts', text: 'roundPrice', cosine: 0.2 }
        ], SEARCH_DEFAULT_LIMIT);
        expect(ranked[0].path).toBe('src/pricing.ts');
        const hits = [{ path: 'a', startLine: 1, endLine: 40 }, { path: 'a', startLine: 33, endLine: 72 }, { path: 'b', startLine: 1, endLine: 10 }];
        expect(dropOverlaps(hits)).toEqual([hits[0], hits[2]]);
    });

    it('cuts a snippet to the window with the most query words', () => {
        const lines = Array.from({ length: 30 }, (_, i) => (i === 20 ? 'const roundPrice = 1;' : `filler ${i}`));
        const window = snippetWindow({ startLine: 11, endLine: 40, text: lines.join('\n') }, 'round price', 5);
        expect(window.text).toContain('roundPrice');
        expect(window.endLine - window.startLine).toBe(4);
    });

    it('formats ranked snippets for the agent, with cache and error notes', () => {
        const text = formatSearchResult({ query: 'round', status, cached: true, hits: [{ path: 'src/pricing.ts', startLine: 3, endLine: 4, score: 0.8123, snippet: 'a\nb' }] });
        expect(text).toContain('1 result for "round" (local index, 3 files, cached)');
        expect(text).toContain('1. src/pricing.ts:3-4 (score 0.81)\n   3| a\n   4| b');
        expect(formatSearchResult({ query: 'x', status, cached: false, hits: [] })).toContain('No matches for "x"');
        expect(formatSearchResult({ query: 'x', status, cached: false, hits: [], error: 'Ollama down' })).toContain('not available: Ollama down');
    });

    it('shows progress, ready and error states for the status bar', () => {
        expect(indexStatusView({ ...status, state: 'indexing', done: 4, total: 9 }).text).toBe('$(sync~spin) Indexing 4/9');
        const ready = indexStatusView(status);
        expect(ready.text).toBe('Index ready');
        expect(ready.tooltip).toContain('3 files, 7 chunks, local embeddings (last pass: 2 embedded, 5 reused from cache)');
        expect(ready.className).toBe('ingot-status-index ingot-status-index-ready');
        expect(indexStatusView({ ...status, state: 'error', error: 'disk full' }).tooltip).toContain('disk full');
    });

    it('clamps limits, filters by folder and evicts the least recently used entry', () => {
        expect(clampLimit(undefined)).toBe(SEARCH_DEFAULT_LIMIT);
        expect(clampLimit(500)).toBe(SEARCH_MAX_LIMIT);
        expect(underPath('src/a.ts', 'src/')).toBe(true);
        expect(underPath('srcs/a.ts', 'src')).toBe(false);
        expect(underPath('a.ts', undefined)).toBe(true);
        const cache = new LruCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a');
        cache.set('c', 3);
        expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([1, undefined, 3]);
    });
});
