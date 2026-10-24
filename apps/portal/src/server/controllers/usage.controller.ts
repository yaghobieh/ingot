import 'server-only';
import { DEFAULT_USAGE_DAYS, USAGE_RANGES } from '@/constants/app.consts';
import { getConfig } from '@server/config/config';
import { authed } from '@server/http/auth';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail, json, readJson } from '@server/http/http';
import { loadSampleUsage, recordUsage, usageRows, usageSummary } from '@server/services/usage.service';
import type { UsageEventInput } from '@server/services/usage.utils';
import { usageToCsv } from '@server/services/usage.utils';

const CSV_EXPORT_LIMIT = 10_000;

function rangeFrom(request: Request): number {
    const days = Number(new URL(request.url).searchParams.get('days'));
    return (USAGE_RANGES as readonly number[]).includes(days) ? days : DEFAULT_USAGE_DAYS;
}

export const getUsage = authed(async (request, user) => {
    const params = new URL(request.url).searchParams;
    const days = rangeFrom(request);
    if (params.get('view') === 'rows') {
        const page = Math.max(0, Math.floor(Number(params.get('page')) || 0));
        return json({ days, page, ...(await usageRows(user.id, days, page)) });
    }
    return json(await usageSummary(user.id, days));
});

/** POST /api/usage: the IDE reports usage events `{ events: [{ model, feature, requests, inputTokens, outputTokens, costUsd, occurredAt }] }`. */
export const postUsage = authed(async (request, user) => {
    const body = await readJson<{ events?: UsageEventInput[] }>(request);
    if (!Array.isArray(body.events)) { fail(HTTP_STATUS.badRequest, 'events_required'); }
    return json({ recorded: await recordUsage(user.id, body.events) }, HTTP_STATUS.created);
});

export const exportUsage = authed(async (request, user) => {
    const { rows } = await usageRows(user.id, rangeFrom(request), 0, CSV_EXPORT_LIMIT);
    return new Response(usageToCsv(rows), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ingot-usage.csv"', 'Cache-Control': 'no-store' }
    });
});

export const sampleUsage = authed(async (_request, user) => {
    if (!getConfig().features.sampleData) { fail(HTTP_STATUS.notFound, 'not_found'); }
    return json({ recorded: await loadSampleUsage(user.id) }, HTTP_STATUS.created);
});
