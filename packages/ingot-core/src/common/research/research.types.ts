/** IDEA-314: Deep Research through the Ingot server (`POST /v1/research`, SSE). */

export type ResearchStage = 'plan' | 'search' | 'read' | 'follow' | 'notes' | 'crosscheck' | 'write';
export type ResearchSourceKind = 'web' | 'news' | 'wikipedia' | 'reddit' | 'hn' | 'github' | 'stackexchange' | 'link';

export interface ResearchSource {
    readonly n: number;
    readonly title: string;
    readonly url: string;
    readonly domain: string;
    readonly via: ResearchSourceKind;
    readonly cited: boolean;
}

export interface ResearchStats {
    readonly pages: number;
    readonly domains: number;
    readonly domainList: readonly string[];
    readonly costUsd: number;
    readonly durationMs: number;
    readonly model: string;
    readonly queries: number;
    readonly candidates: number;
    readonly budgetHit: boolean;
}

/** One `data: {json}` event of the server stream. */
export type ResearchEvent =
    | { readonly type: 'start'; readonly id: string; readonly question: string; readonly limits: { readonly maxCostUsd: number; readonly maxPages: number }; readonly model: string }
    | { readonly type: 'plan'; readonly queries: readonly string[] }
    | { readonly type: 'progress'; readonly stage: ResearchStage; readonly message: string; readonly source?: string; readonly done?: number; readonly total?: number }
    | { readonly type: 'found'; readonly count: number; readonly domains: number }
    | { readonly type: 'page'; readonly n: number; readonly url: string; readonly title: string; readonly domain: string; readonly ok: boolean }
    | { readonly type: 'cost'; readonly costUsd: number; readonly maxCostUsd: number }
    | { readonly type: 'answer'; readonly answer: string; readonly markdown: string; readonly sources: readonly ResearchSource[] }
    | { readonly type: 'done'; readonly stats: ResearchStats }
    | { readonly type: 'error'; readonly code: string; readonly message?: string };

export interface ResearchPage {
    readonly url: string;
    readonly title: string;
    readonly domain: string;
}

/** A run as the chat draws it (kept on the chat message, so it survives a reload). */
export interface ResearchView {
    readonly question: string;
    readonly stage: ResearchStage | 'done' | 'error' | 'stopped';
    /** "Searching Reddit…", "Read 12 of 24 pages". */
    readonly status: string;
    readonly queries: readonly string[];
    readonly pages: readonly ResearchPage[];
    readonly found: number;
    readonly costUsd: number;
    readonly maxCostUsd: number;
    readonly sources?: readonly ResearchSource[];
    readonly stats?: ResearchStats;
    readonly error?: string;
}

export interface ResearchOptions {
    readonly maxCostUsd?: number;
    readonly maxPages?: number;
}

export interface ResearchPoll {
    readonly events: readonly ResearchEvent[];
    readonly done: boolean;
    readonly error?: string;
}

export const ResearchService = Symbol('IngotResearchService');

/** Backend side: runs the request with the signed-in account's token; the frontend polls for events. */
export interface ResearchService {
    start(question: string, options?: ResearchOptions): Promise<string>;
    poll(id: string, from: number): Promise<ResearchPoll>;
    cancel(id: string): Promise<void>;
}
