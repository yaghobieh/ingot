/** IDEA-307 cost forecast: USD per 1M tokens, and the estimate shown in the composer before a run. */
export interface ModelPrice {
    readonly input: number;
    readonly output: number;
}

export interface CostInput {
    /** System prompt, rules, files and memories of the last request (or a default before the first one). */
    readonly systemTokens: number;
    readonly historyTokens: number;
    readonly promptTokens: number;
    readonly mode: string;
    readonly price: ModelPrice;
}

export interface CostEstimate {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly usd: number;
}

/** What the composer shows: the estimate on the model the run would use (the router's pick when it routes). */
export interface CostForecast {
    readonly estimate: CostEstimate;
    readonly model: string;
    readonly price: ModelPrice;
    readonly routed?: import('../router/router.types').RouteDecision;
    readonly warnUsd: number;
    readonly over: boolean;
}

export interface ForecastRequest {
    /** The chat's model, resolved (not Auto). */
    readonly model: string;
    readonly prompt: string;
    readonly mode: string;
    readonly files: number;
    readonly historyTokens: number;
    /** Measured on the chat's last request; undefined before the first one. */
    readonly systemTokens?: number;
}
