'use client';

import { Button } from '@forgedevstack/bear';
import { useState } from 'react';
import { DEFAULT_USAGE_DAYS, USAGE_PAGE_SIZE } from '@/constants/app.consts';
import { modelLabel } from '@/constants/models.consts';
import { formatDate, formatNumber, formatUsd } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { UsageRow } from '@/types/domain.types';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';
import { RangePicker } from '@components/RangePicker';

interface RowsResponse {
    rows: UsageRow[];
    total: number;
    page: number;
}

export function UsageView() {
    const { t, locale } = usePortal();
    const [days, setDays] = useState(DEFAULT_USAGE_DAYS);
    const [page, setPage] = useState(0);
    const { data } = useApi<RowsResponse>(`/api/usage?view=rows&days=${days}&page=${page}`);
    const pages = Math.max(1, Math.ceil((data?.total ?? 0) / USAGE_PAGE_SIZE));

    const changeRange = (next: number) => {
        setDays(next);
        setPage(0);
    };

    return (
        <div className="stack">
            <PageHeader
                title={t('usage.title')}
                subtitle={t('usage.subtitle')}
                actions={(
                    <div className="row">
                        <RangePicker value={days} onChange={changeRange} />
                        <a className="btn-link btn-ghost" href={`/api/usage/export?days=${days}`} download data-testid="export-csv">{t('usage.export')}</a>
                    </div>
                )}
            />
            <div className="panel table-wrap">
                {data && data.rows.length === 0 ? <p className="muted" data-testid="usage-table-empty">{t('usage.empty')}</p> : (
                    <table className="data" data-testid="usage-table">
                        <thead>
                            <tr>
                                <th>{t('usage.date')}</th><th>{t('usage.model')}</th><th>{t('usage.feature')}</th>
                                <th className="num">{t('usage.requests')}</th><th className="num">{t('usage.input')}</th><th className="num">{t('usage.output')}</th><th className="num">{t('usage.cost')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data?.rows.map(row => (
                                <tr key={row.id}>
                                    <td>{formatDate(row.occurredAt, locale, true)}</td>
                                    <td>{modelLabel(row.model)}</td>
                                    <td><span className="pill">{row.feature}</span></td>
                                    <td className="num">{formatNumber(row.requests, locale)}</td>
                                    <td className="num">{formatNumber(row.inputTokens, locale)}</td>
                                    <td className="num">{formatNumber(row.outputTokens, locale)}</td>
                                    <td className="num">{formatUsd(row.costUsd, locale)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            <div className="row">
                <span className="muted" data-testid="usage-page">{t('usage.page', { page: page + 1, pages })}</span>
                <span className="spacer" />
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} testId="usage-prev">{t('usage.prev')}</Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} testId="usage-next">{t('usage.next')}</Button>
            </div>
        </div>
    );
}
