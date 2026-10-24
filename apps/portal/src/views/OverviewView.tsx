'use client';

import { Button, Spinner } from '@forgedevstack/bear';
import Link from 'next/link';
import { useState } from 'react';
import { DEFAULT_USAGE_DAYS, ROUTES } from '@/constants/app.consts';
import { modelLabel } from '@/constants/models.consts';
import { api } from '@/lib/api';
import { formatNumber, formatUsd, shortDay } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { UsageSummary } from '@/types/domain.types';
import { BarChart } from '@components/BarChart';
import { CHART_HALF_WIDTH } from '@components/BarChart/BarChart.consts';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';
import type { OverviewViewProps } from '@/views/views.types';
import { RangePicker } from '@components/RangePicker';
import { StatCard } from '@components/StatCard';

export function OverviewView({ sampleData }: OverviewViewProps) {
    const { t, locale } = usePortal();
    const [days, setDays] = useState(DEFAULT_USAGE_DAYS);
    const { data, loading, reload } = useApi<UsageSummary>(`/api/usage?days=${days}`);
    const [seeding, setSeeding] = useState(false);

    const loadSample = async () => {
        setSeeding(true);
        await api('/api/usage/sample', { method: 'POST' }).catch(() => undefined);
        setSeeding(false);
        await reload();
    };

    const labels = data?.byDay.map(day => shortDay(day.day, locale)) ?? [];
    const maxModelCost = Math.max(0, ...(data?.byModel.map(m => m.costUsd) ?? []));
    const empty = data && data.totals.requests === 0;

    return (
        <div className="stack">
            <PageHeader title={t('overview.title')} subtitle={t('overview.range', { days })} actions={<RangePicker value={days} onChange={setDays} />} />
            {loading && !data ? <Spinner label={t('common.loading')} /> : null}
            {data ? (
                <>
                    <div className="grid-3">
                        <StatCard testId="stat-requests" label={t('overview.requests')} value={formatNumber(data.totals.requests, locale)} />
                        <StatCard testId="stat-tokens" label={t('overview.tokens')} value={formatNumber(data.totals.inputTokens + data.totals.outputTokens, locale)}
                            hint={`${t('overview.input')} ${formatNumber(data.totals.inputTokens, locale)} · ${t('overview.output')} ${formatNumber(data.totals.outputTokens, locale)}`} />
                        <StatCard testId="stat-cost" label={t('overview.cost')} value={formatUsd(data.totals.costUsd, locale)} />
                    </div>
                    {empty ? (
                        <div className="panel empty" data-testid="usage-empty">
                            <h2>{t('overview.emptyTitle')}</h2>
                            <p className="muted">{t('overview.emptyBody')}</p>
                            <div className="row" style={{ justifyContent: 'center' }}>
                                <Link className="btn-link btn-primary" href={ROUTES.device}>{t('overview.connectIde')}</Link>
                                {sampleData ? <Button variant="outline" loading={seeding} onClick={loadSample} testId="load-sample">{t('overview.loadSample')}</Button> : null}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="panel">
                                <div className="panel-head"><h2>{t('overview.requestsByDay')}</h2></div>
                                <BarChart testId="chart-requests" ariaLabel={t('overview.requestsByDay')} labels={labels}
                                    series={[{ label: t('overview.requests'), values: data.byDay.map(d => d.requests), className: 'bar' }]}
                                    format={value => formatNumber(Math.round(value), locale)} />
                            </div>
                            <div className="grid-2">
                                <div className="panel">
                                    <div className="panel-head">
                                        <h2>{t('overview.tokensByDay')}</h2>
                                        <span className="spacer" />
                                        <div className="legend"><span><i style={{ background: 'var(--ingot-primary)' }} />{t('overview.input')}</span><span><i style={{ background: 'var(--ingot-ingot-gold)' }} />{t('overview.output')}</span></div>
                                    </div>
                                    <BarChart testId="chart-tokens" width={CHART_HALF_WIDTH} ariaLabel={t('overview.tokensByDay')} labels={labels}
                                        series={[
                                            { label: t('overview.input'), values: data.byDay.map(d => d.inputTokens), className: 'bar' },
                                            { label: t('overview.output'), values: data.byDay.map(d => d.outputTokens), className: 'bar-alt' }
                                        ]}
                                        format={value => formatNumber(Math.round(value), locale)} />
                                </div>
                                <div className="panel" data-testid="cost-by-model">
                                    <div className="panel-head"><h2>{t('overview.costByModel')}</h2></div>
                                    <div className="stack-sm">
                                        {data.byModel.map(model => (
                                            <div className="hbar" key={model.model}>
                                                <span>{modelLabel(model.model)}</span>
                                                <div className="hbar-track"><div className="hbar-fill" style={{ width: `${maxModelCost ? (model.costUsd / maxModelCost) * 100 : 0}%` }} /></div>
                                                <span className="mono" style={{ textAlign: 'end' }}>{formatUsd(model.costUsd, locale)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </>
            ) : null}
        </div>
    );
}
