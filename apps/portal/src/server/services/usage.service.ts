import 'server-only';
import { MICROS_PER_USD, USAGE_PAGE_SIZE } from '@/constants/app.consts';
import type { UsageByModel, UsageDay, UsageRow, UsageSummary } from '@/types/domain.types';
import { query, queryOne } from '@server/db/db';
import { emptyTotals, fillDays, normalizeUsageEvent, sampleUsageEvents } from '@server/services/usage.utils';
import type { UsageEventInput } from '@server/services/usage.utils';

const MAX_EVENTS_PER_BATCH = 500;

interface TotalsRow {
    requests: string | null;
    input_tokens: string | null;
    output_tokens: string | null;
    cost_micros: string | null;
}

const toTotals = (row: TotalsRow | undefined) => row ? {
    requests: Number(row.requests ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    costUsd: Number(row.cost_micros ?? 0) / MICROS_PER_USD
} : emptyTotals();

const SUMS = 'sum(requests) AS requests, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, sum(cost_micros) AS cost_micros';
const RANGE = 'user_id = $1 AND occurred_at > now() - make_interval(days => $2)';

export async function recordUsage(userId: string, inputs: UsageEventInput[]): Promise<number> {
    const events = inputs.slice(0, MAX_EVENTS_PER_BATCH).map(normalizeUsageEvent).filter(event => event !== undefined);
    for (const event of events) {
        await query(
            'INSERT INTO usage_events (user_id, model, feature, requests, input_tokens, output_tokens, cost_micros, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [userId, event.model, event.feature, event.requests, event.inputTokens, event.outputTokens, event.costMicros, event.occurredAt]
        );
    }
    return events.length;
}

export async function usageSummary(userId: string, days: number): Promise<UsageSummary> {
    const totals = await queryOne<TotalsRow>(`SELECT ${SUMS} FROM usage_events WHERE ${RANGE}`, [userId, days]);
    const dayRows = await query<TotalsRow & { day: string }>(
        `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, ${SUMS} FROM usage_events WHERE ${RANGE} GROUP BY 1 ORDER BY 1`,
        [userId, days]
    );
    const modelRows = await query<TotalsRow & { model: string }>(
        `SELECT model, ${SUMS} FROM usage_events WHERE ${RANGE} GROUP BY model ORDER BY sum(cost_micros) DESC`,
        [userId, days]
    );
    const byDay: UsageDay[] = dayRows.map(row => ({ day: row.day, ...toTotals(row) }));
    const byModel: UsageByModel[] = modelRows.map(row => ({ model: row.model, ...toTotals(row) }));
    return { days, totals: toTotals(totals), byDay: fillDays(byDay, days), byModel };
}

export async function usageRows(userId: string, days: number, page: number, pageSize = USAGE_PAGE_SIZE): Promise<{ rows: UsageRow[]; total: number }> {
    const rows = await query<TotalsRow & { id: string; model: string; feature: string; occurred_at: Date }>(
        `SELECT id::text, model, feature, requests, input_tokens, output_tokens, cost_micros, occurred_at FROM usage_events WHERE ${RANGE} ORDER BY occurred_at DESC LIMIT $3 OFFSET $4`,
        [userId, days, pageSize, page * pageSize]
    );
    const count = await queryOne<{ count: string }>(`SELECT count(*) FROM usage_events WHERE ${RANGE}`, [userId, days]);
    return {
        rows: rows.map(row => ({ id: row.id, model: row.model, feature: row.feature, occurredAt: row.occurred_at.toISOString(), ...toTotals(row) })),
        total: Number(count?.count ?? 0)
    };
}

export async function loadSampleUsage(userId: string): Promise<number> {
    return recordUsage(userId, sampleUsageEvents());
}
