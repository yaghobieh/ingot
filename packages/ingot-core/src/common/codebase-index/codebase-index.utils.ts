import {
    BIGRAM_WEIGHT, CHUNK_LINES, CHUNK_MAX_CHARS, CHUNK_OVERLAP_LINES, LEXICAL_WEIGHT, LOCAL_EMBED_DIMS, MIN_SEARCH_SCORE, MIN_STEM_CHARS, MIN_TOKEN_CHARS, PLURAL_IES,
    SCORE_DIGITS, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, SNIPPET_MAX_LINE_CHARS, SNIPPET_MAX_LINES, STOP_WORDS, INDEX_STATUS_CLASS, INDEX_STATUS_TEXT
} from './codebase-index.consts';
import type { IndexStatus, RankCandidate, SearchResult, TextChunk } from './codebase-index.types';

const WORD_RE = /[A-Za-z][A-Za-z0-9_]*|\d+/g;
const CAMEL_RE = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SIGN_BIT = 0x80000000;

/** 32-bit FNV-1a. */
export const fnv1a = (text: string): number => {
    let hash = FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }
    return hash >>> 0;
};

const stem = (word: string): string => {
    if (word.endsWith(PLURAL_IES) && word.length - PLURAL_IES.length >= MIN_STEM_CHARS) {
        return `${word.slice(0, -PLURAL_IES.length)}y`;
    }
    for (const suffix of ['ing', 'ed', 's']) {
        if (word.endsWith(suffix) && !word.endsWith('ss') && word.length - suffix.length >= MIN_STEM_CHARS) {
            return word.slice(0, -suffix.length);
        }
    }
    return word;
};

const keep = (word: string): boolean => word.length >= MIN_TOKEN_CHARS && !STOP_WORDS.has(word);

/** Lower-case, stemmed words: `roundPrice` gives `roundprice`, `round` and `price`; snake_case splits the same way. */
export const tokenize = (text: string): string[] => {
    const out: string[] = [];
    for (const word of text.match(WORD_RE) ?? []) {
        const parts = word.split('_').flatMap(part => part.match(CAMEL_RE) ?? []).map(part => part.toLowerCase());
        if (parts.length > 1 && keep(word.toLowerCase())) {
            out.push(word.toLowerCase());
        }
        out.push(...parts.filter(keep).map(stem));
    }
    return out;
};

/** Unit-length copy (zero vectors stay zero). */
export const normalize = (vector: Float32Array): Float32Array => {
    let sum = 0;
    for (const value of vector) {
        sum += value * value;
    }
    const length = Math.sqrt(sum);
    return length ? vector.map(value => value / length) : vector;
};

const addFeature = (vector: Float32Array, feature: string, weight: number): void => {
    const hash = fnv1a(feature);
    vector[hash % vector.length] += hash & SIGN_BIT ? -weight : weight;
};

/**
 * The local, free embedding: signed feature hashing of words and word pairs, with sub-linear term weights.
 * Not a learned model, but it finds code by its vocabulary (identifiers split into words) and costs no tokens.
 */
export const hashEmbed = (text: string, dims: number = LOCAL_EMBED_DIMS): Float32Array => {
    const vector = new Float32Array(dims);
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    tokens.forEach((token, i) => {
        counts.set(token, (counts.get(token) ?? 0) + 1);
        if (i > 0) {
            const pair = `${tokens[i - 1]} ${token}`;
            counts.set(pair, (counts.get(pair) ?? 0) + BIGRAM_WEIGHT);
        }
    });
    for (const [feature, count] of counts) {
        addFeature(vector, feature, 1 + Math.log(Math.max(1, count)));
    }
    return normalize(vector);
};

export const dot = (left: Float32Array, right: Float32Array): number => {
    const size = Math.min(left.length, right.length);
    let sum = 0;
    for (let i = 0; i < size; i++) {
        sum += left[i] * right[i];
    }
    return sum;
};

/** Overlapping line windows. Blank windows are dropped; long lines are cut so one chunk stays small. */
export const chunkText = (text: string, lines: number = CHUNK_LINES, overlap: number = CHUNK_OVERLAP_LINES): TextChunk[] => {
    const all = text.split('\n');
    const step = Math.max(1, lines - overlap);
    const chunks: TextChunk[] = [];
    for (let start = 0; start < all.length; start += step) {
        const end = Math.min(all.length, start + lines);
        const body = all.slice(start, end).join('\n');
        if (body.trim()) {
            chunks.push({ startLine: start + 1, endLine: end, text: body.slice(0, CHUNK_MAX_CHARS) });
        }
        if (end >= all.length) {
            break;
        }
    }
    return chunks;
};

/** Share of the query's words found in the chunk or in its path. */
export const lexicalScore = (queryTokens: ReadonlySet<string>, text: string, path: string): number => {
    if (!queryTokens.size) {
        return 0;
    }
    const found = new Set([...tokenize(text), ...tokenize(path)]);
    let hits = 0;
    for (const token of queryTokens) {
        if (found.has(token)) {
            hits++;
        }
    }
    return hits / queryTokens.size;
};

/** Hybrid score: cosine similarity plus the lexical share, best first, weak matches dropped. */
export const rankCandidates = <T extends RankCandidate>(query: string, candidates: readonly T[], limit: number): (T & { score: number })[] => {
    const tokens = new Set(tokenize(query));
    return candidates
        .map(candidate => ({ ...candidate, score: (1 - LEXICAL_WEIGHT) * candidate.cosine + LEXICAL_WEIGHT * lexicalScore(tokens, candidate.text, candidate.path) }))
        .filter(candidate => candidate.score >= MIN_SEARCH_SCORE)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, limit);
};

/** Keeps the best of overlapping hits in one file (chunks overlap by a few lines). Input is best first. */
export const dropOverlaps = <T extends { path: string; startLine: number; endLine: number }>(hits: readonly T[]): T[] => {
    const kept: T[] = [];
    for (const hit of hits) {
        if (!kept.some(k => k.path === hit.path && k.startLine <= hit.endLine && hit.startLine <= k.endLine)) {
            kept.push(hit);
        }
    }
    return kept;
};

/** The window of a chunk with the most query words, so a result costs few tokens. */
export const snippetWindow = (chunk: TextChunk, query: string, maxLines: number = SNIPPET_MAX_LINES): TextChunk => {
    const lines = chunk.text.split('\n');
    if (lines.length <= maxLines) {
        return chunk;
    }
    const tokens = new Set(tokenize(query));
    const weights = lines.map(line => tokenize(line).filter(token => tokens.has(token)).length);
    let best = 0;
    let bestSum = -1;
    for (let start = 0; start + maxLines <= lines.length; start++) {
        const sum = weights.slice(start, start + maxLines).reduce((a, b) => a + b, 0);
        if (sum > bestSum) {
            best = start;
            bestSum = sum;
        }
    }
    return { startLine: chunk.startLine + best, endLine: chunk.startLine + best + maxLines - 1, text: lines.slice(best, best + maxLines).join('\n') };
};

export const clampLimit = (value: unknown): number => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(SEARCH_MAX_LIMIT, n) : SEARCH_DEFAULT_LIMIT;
};

/** Project-relative path filter for search: a folder prefix or an exact file. */
export const underPath = (path: string, filter: string | undefined): boolean => {
    const clean = (filter ?? '').trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
    return !clean || clean === '.' || path === clean || path.startsWith(`${clean}/`);
};

/** A small least-recently-used cache. */
export class LruCache<K, V> {
    protected readonly map = new Map<K, V>();

    constructor(protected readonly size: number) { }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.size) {
            this.map.delete(this.map.keys().next().value as K);
        }
    }

    clear(): void {
        this.map.clear();
    }
}

const numbered = (text: string, start: number): string => text.split('\n')
    .map((line, i) => `   ${start + i}| ${line.length > SNIPPET_MAX_LINE_CHARS ? `${line.slice(0, SNIPPET_MAX_LINE_CHARS)}…` : line}`)
    .join('\n');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The tool result the agent reads: ranked snippets with paths and line ranges. */
export const formatSearchResult = (result: SearchResult): string => {
    if (result.error) {
        return `The codebase index is not available: ${result.error}. Use ingot/grep instead.`;
    }
    const { status } = result;
    const building = status.state === 'indexing' ? `, still indexing ${status.done}/${status.total}` : '';
    const source = `${status.provider} index, ${plural(status.files, 'file')}${building}${result.cached ? ', cached' : ''}`;
    if (!result.hits.length) {
        return `No matches for "${result.query}" (${source}). Try ingot/grep for exact text.`;
    }
    return [
        `${plural(result.hits.length, 'result')} for "${result.query}" (${source}). Read more with ingot/read_file.`,
        ...result.hits.map((hit, i) => `${i + 1}. ${hit.path}:${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(SCORE_DIGITS)})\n${numbered(hit.snippet, hit.startLine)}`)
    ].join('\n');
};

export interface IndexStatusView {
    readonly text: string;
    readonly tooltip: string;
    readonly className: string;
}

/** Status bar text: a spinner with progress while indexing, "Index ready" with counts in the tooltip. */
export const indexStatusView = (status: IndexStatus): IndexStatusView => {
    const className = `${INDEX_STATUS_CLASS} ${INDEX_STATUS_CLASS}-${status.state}`;
    const counts = `${plural(status.files, 'file')}, ${plural(status.chunks, 'chunk')}, ${status.provider} embeddings`;
    const cache = `last pass: ${status.embedded} embedded, ${status.reused} reused from cache`;
    switch (status.state) {
        case 'indexing': return { text: `$(sync~spin) Indexing ${status.done}/${status.total}`, tooltip: `Codebase index: building (${counts})`, className };
        case 'error': return { text: `$(warning) ${INDEX_STATUS_TEXT.error}`, tooltip: `Codebase index failed: ${status.error ?? 'unknown error'}. Click to rebuild.`, className };
        case 'ready': return { text: INDEX_STATUS_TEXT.ready, tooltip: `Codebase index: ${counts} (${cache}). Click to rebuild.`, className };
        default: return { text: INDEX_STATUS_TEXT.idle, tooltip: 'Codebase index: waiting to start', className };
    }
};
