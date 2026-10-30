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

export interface TabIgnoreRule {
    readonly regex: RegExp;
    readonly negate: boolean;
    readonly dirOnly: boolean;
    /** Has a slash, so it matches from the workspace root instead of any path segment. */
    readonly anchored: boolean;
}
