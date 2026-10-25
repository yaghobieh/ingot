// Copied from ingot-server packages/shared/src/usage.types.ts (canonical copy). Keep in sync; do not edit here.
/** One completed model call, as posted by the gateway's usage callback. */
export interface GatewayUsageEvent {
    requestId: string;
    userId: string;
    model: string;
    feature?: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    occurredAt: string;
}

export interface GatewayUsageBatch {
    events: GatewayUsageEvent[];
}

export interface UsageTotals {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface UsageDay extends UsageTotals { day: string }
export interface UsageByModel extends UsageTotals { model: string }

export interface UsageSummary {
    /** Length of the range in days (kept for the portal's 7/30/90 picker). */
    days: number;
    from: string;
    to: string;
    totals: UsageTotals;
    byDay: UsageDay[];
    byModel: UsageByModel[];
}

export interface UsageRow extends UsageTotals {
    id: string;
    model: string;
    feature: string;
    occurredAt: string;
}

export interface BalancePeriod {
    /** Inclusive ISO start of the billing period (UTC calendar month). */
    start: string;
    /** Exclusive ISO end. */
    end: string;
}

/** GET /api/balance: tokens and spend left in the current period. */
export interface BalanceResponse {
    plan: string;
    period: BalancePeriod;
    tokens: { allowance: number; granted: number; used: number; remaining: number };
    spend: { budgetUsd: number | null; usedUsd: number; remainingUsd: number | null };
    byModel: UsageByModel[];
}
