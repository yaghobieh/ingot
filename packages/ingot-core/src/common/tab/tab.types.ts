import type { ChatMessage } from '../models/models.types';

/** One edit the user made recently; the line's current text gives the model the intent. */
export interface TabRecentEdit {
    readonly line: number;
    readonly text: string;
}

/** Everything one fill-in-the-middle request sends. Only built for files `.ingotignore` allows. */
export interface TabContext {
    readonly language: string;
    readonly path: string;
    readonly prefix: string;
    readonly suffix: string;
    readonly recentEdits: readonly TabRecentEdit[];
}

/** A parsed model reply: ghost text to insert and, optionally, the text of the line to edit next. */
export interface TabPrediction {
    readonly insertText: string;
    /** The ghost text replaces the rest of the line (which it still contains) instead of going in front of it. */
    readonly replacesSuffix: boolean;
    readonly nextSnippet?: string;
}

export interface TabLimits {
    readonly maxRequestsPerDay: number;
    readonly maxTokensPerDay: number;
}

/** Requests and (estimated) tokens spent on one local calendar day. */
export interface TabUsage {
    readonly day: string;
    readonly requests: number;
    readonly tokens: number;
}

export type TabBudgetBlock = 'requests' | 'tokens';

/** What one Tab request needs from the editor, the budget and the model; mocked in unit tests. */
export interface TabEngineDeps {
    isIgnored(): Promise<boolean>;
    buildContext(): TabContext;
    checkBudget(estimatedTokens: number): Promise<TabBudgetBlock | undefined>;
    recordRequest(tokens: number): Promise<void>;
    recordReply(tokens: number): Promise<void>;
    complete(messages: readonly ChatMessage[]): Promise<string>;
    isCancelled(): boolean;
}

export type TabSkipReason = 'ignored' | 'cancelled' | 'error' | TabBudgetBlock;

export type TabOutcome =
    | { readonly kind: 'prediction'; readonly prediction: TabPrediction }
    | { readonly kind: 'skipped'; readonly reason: TabSkipReason; readonly error?: string };

export interface TabIgnoreRule {
    readonly regex: RegExp;
    readonly negate: boolean;
    readonly dirOnly: boolean;
    /** Has a slash, so it matches from the workspace root instead of any path segment. */
    readonly anchored: boolean;
}

/** IDEA-287: an accepted Tab completion, for Cursor's afterTabFileEdit hook. Lines and columns are 1-based (Monaco). */
export interface TabAcceptedEdit {
    readonly uri: string;
    readonly range: { readonly startLineNumber: number; readonly startColumn: number; readonly endLineNumber: number; readonly endColumn: number };
    readonly oldText: string;
    readonly newText: string;
    readonly oldLine: string;
    readonly nextSnippet?: string;
}
