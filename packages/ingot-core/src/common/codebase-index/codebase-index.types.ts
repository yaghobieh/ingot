import type { RpcServer } from '@theia/core/lib/common/messaging';
import type { EMBEDDING_PROVIDERS } from './codebase-index.consts';

export type EmbeddingProviderId = typeof EMBEDDING_PROVIDERS[number];

/** Non-secret settings from preferences. The local provider needs nothing and costs no tokens. */
export interface EmbeddingSettings {
    readonly provider: EmbeddingProviderId;
    readonly ollamaBaseUrl?: string;
    readonly ollamaModel?: string;
}

/** Turns text into unit-length vectors. `key` names the vector space; vectors from different keys never mix. */
export interface EmbeddingProvider {
    readonly key: string;
    readonly label: string;
    embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export interface TextChunk {
    /** 1-based, inclusive. */
    readonly startLine: number;
    readonly endLine: number;
    readonly text: string;
}

export type IndexState = 'idle' | 'indexing' | 'ready' | 'error';

export interface IndexStatus {
    /** Absolute path of the project root. */
    readonly root: string;
    readonly state: IndexState;
    readonly files: number;
    readonly chunks: number;
    /** Progress of the current (or last) pass. */
    readonly done: number;
    readonly total: number;
    /** Embeddings computed in the last pass, and ones reused from the cache. */
    readonly embedded: number;
    readonly reused: number;
    readonly provider: string;
    readonly updatedAt?: number;
    readonly error?: string;
}

export interface SearchOptions {
    readonly limit?: number;
    /** Only files under this project-relative folder (or that exact file). */
    readonly path?: string;
}

export interface SearchHit {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly score: number;
    readonly snippet: string;
}

export interface SearchResult {
    readonly query: string;
    readonly hits: readonly SearchHit[];
    readonly status: IndexStatus;
    /** Served from the result cache (same query, unchanged index). */
    readonly cached: boolean;
    readonly error?: string;
}

/** A candidate for the lexical rerank. */
export interface RankCandidate {
    readonly path: string;
    readonly text: string;
    readonly cosine: number;
}

export interface CodebaseIndexClient {
    onStatusChanged(status: IndexStatus): void;
}

export const CodebaseIndexService = Symbol('IngotCodebaseIndexService');

export interface CodebaseIndexService extends RpcServer<CodebaseIndexClient> {
    /** Loads `.ingot/index`, brings it up to date in the background and watches the folder. */
    open(root: string, settings: EmbeddingSettings): Promise<IndexStatus>;
    close(root: string): Promise<void>;
    status(root: string): Promise<IndexStatus | undefined>;
    /** Re-chunks every file; embeddings of unchanged chunks still come from the cache. */
    rebuild(root: string): Promise<IndexStatus>;
    search(root: string, query: string, options?: SearchOptions): Promise<SearchResult>;
}
