/** Rough token estimate (≈4 characters per token); good enough for a usage meter. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface ContextUsage {
    readonly system: number;
    readonly rules: number;
    readonly files: number;
    readonly memories: number;
    readonly history: number;
    readonly total: number;
    readonly window: number;
}

export type ContextParts = Omit<ContextUsage, 'total' | 'window'>;

/** Above this share of the window, the chat offers "Summarize & continue". */
export const CONTEXT_NEAR_FULL = 0.8;

export const contextUsage = (parts: ContextParts, window: number): ContextUsage => ({
    ...parts, window, total: parts.system + parts.rules + parts.files + parts.memories + parts.history
});

export const usageRatio = (usage: ContextUsage | undefined): number => usage && usage.window > 0 ? Math.min(1, usage.total / usage.window) : 0;

export const formatTokens = (n: number): string => n >= 1_000_000 ? `${trim(n / 1_000_000)}M` : n >= 1000 ? `${trim(n / 1000)}k` : String(n);
const trim = (n: number): string => (Math.round(n * 10) / 10).toString();

export const usageBreakdown = (u: ContextUsage): string => [
    `${formatTokens(u.total)} of ${formatTokens(u.window)} tokens (${Math.round(usageRatio(u) * 100)}%)`,
    `System & tools: ${formatTokens(u.system)}`, `Rules: ${formatTokens(u.rules)}`, `Files: ${formatTokens(u.files)}`,
    `Memories: ${formatTokens(u.memories)}`, `Conversation: ${formatTokens(u.history)}`
].join('\n');

export const SUMMARIZE_PROMPT = 'Summarize this conversation so another agent can continue it: the goal, decisions made, files involved, what is done and what is left. Be concise; use bullet points.';
