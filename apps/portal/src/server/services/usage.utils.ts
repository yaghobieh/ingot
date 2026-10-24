import { MICROS_PER_USD } from '@/constants/app.consts';
import { MODELS } from '@/constants/models.consts';
import type { UsageDay, UsageRow, UsageTotals } from '@/types/domain.types';

export interface UsageEventInput {
    model: string;
    feature?: string;
    requests?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    occurredAt?: string;
}

const MAX_EVENT_TOKENS = 10_000_000;
const MAX_EVENT_COST_USD = 1000;
const MAX_EVENT_REQUESTS = 10_000;
const MAX_MODEL_LENGTH = 100;

function clampInt(value: unknown, max: number, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
}

/** Validates and normalizes one IDE-reported usage event; returns undefined when invalid. */
export function normalizeUsageEvent(input: UsageEventInput): Required<Omit<UsageEventInput, 'costUsd'>> & { costMicros: number } | undefined {
    if (typeof input?.model !== 'string' || !input.model.trim() || input.model.length > MAX_MODEL_LENGTH) { return undefined; }
    const cost = Number(input.costUsd ?? 0);
    const occurred = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurred.getTime())) { return undefined; }
    return {
        model: input.model.trim(),
        feature: typeof input.feature === 'string' && input.feature ? input.feature.slice(0, MAX_MODEL_LENGTH) : 'agent',
        requests: clampInt(input.requests, MAX_EVENT_REQUESTS, 1),
        inputTokens: clampInt(input.inputTokens, MAX_EVENT_TOKENS),
        outputTokens: clampInt(input.outputTokens, MAX_EVENT_TOKENS),
        costMicros: Number.isFinite(cost) && cost >= 0 ? Math.round(Math.min(cost, MAX_EVENT_COST_USD) * MICROS_PER_USD) : 0,
        occurredAt: occurred.toISOString()
    };
}

export function emptyTotals(): UsageTotals {
    return { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

/** Fills missing days with zeros so charts always show the full range (oldest first). */
export function fillDays(rows: UsageDay[], days: number, today = new Date()): UsageDay[] {
    const byDay = new Map(rows.map(row => [row.day, row]));
    const out: UsageDay[] = [];
    for (let offset = days - 1; offset >= 0; offset--) {
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
        const key = date.toISOString().slice(0, 10);
        out.push(byDay.get(key) ?? { day: key, ...emptyTotals() });
    }
    return out;
}

const CSV_HEADER = 'occurred_at,model,feature,requests,input_tokens,output_tokens,cost_usd';

function csvCell(value: string | number): string {
    const text = String(value);
    return /[",\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function usageToCsv(rows: UsageRow[]): string {
    const lines = rows.map(row => [row.occurredAt, row.model, row.feature, row.requests, row.inputTokens, row.outputTokens, row.costUsd.toFixed(6)].map(csvCell).join(','));
    return [CSV_HEADER, ...lines].join('\n');
}

const SAMPLE_FEATURES = ['agent', 'chat', 'autocomplete', 'edit'];
const SAMPLE_DAYS = 30;
const SAMPLE_COST_PER_1K = 0.004;
const TOKENS_PER_K = 1000;

/** Deterministic-ish sample data for the "Load sample usage" button (dev/demo only). */
export function sampleUsageEvents(now = new Date(), random: () => number = Math.random): UsageEventInput[] {
    const models = MODELS.filter(model => model.defaultEnabled);
    const events: UsageEventInput[] = [];
    for (let day = 0; day < SAMPLE_DAYS; day++) {
        const perDay = 3 + Math.floor(random() * 6);
        for (let i = 0; i < perDay; i++) {
            const model = models[Math.floor(random() * models.length)];
            const inputTokens = 500 + Math.floor(random() * 12_000);
            const outputTokens = 200 + Math.floor(random() * 4000);
            events.push({
                model: model.id,
                feature: model.kind === 'autocomplete' ? 'autocomplete' : SAMPLE_FEATURES[Math.floor(random() * SAMPLE_FEATURES.length)],
                requests: 1 + Math.floor(random() * 8),
                inputTokens,
                outputTokens,
                costUsd: ((inputTokens + outputTokens) / TOKENS_PER_K) * SAMPLE_COST_PER_1K,
                occurredAt: new Date(now.getTime() - day * 86_400_000 - Math.floor(random() * 80_000_000)).toISOString()
            });
        }
    }
    return events;
}
