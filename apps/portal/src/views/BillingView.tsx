'use client';

import { Alert, Badge, Button } from '@forgedevstack/bear';
import Link from 'next/link';
import { useState } from 'react';
import { ROUTES } from '@/constants/app.consts';
import { PAID_PLANS, PLANS } from '@/constants/plans.consts';
import { api, errorCode } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { BillingInfo, PlanId } from '@/types/domain.types';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';

type CheckoutResponse = { kind: 'redirect'; url: string } | { kind: 'stubbed' };

export function BillingView() {
    const { t, locale } = usePortal();
    const { data } = useApi<BillingInfo>('/api/billing');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState<PlanId | ''>('');

    const upgrade = async (plan: PlanId) => {
        setBusy(plan);
        setMessage('');
        try {
            const result = await api<CheckoutResponse>('/api/billing/checkout', { method: 'POST', body: { plan } });
            if (result.kind === 'redirect') { window.location.href = result.url; return; }
            setMessage(t('billing.checkoutStubbed'));
        } catch (err) {
            setMessage(t(`errors.${errorCode(err)}`));
        }
        setBusy('');
    };

    return (
        <div className="stack">
            <PageHeader title={t('billing.title')} actions={<Link href={ROUTES.pricing} className="btn-link btn-ghost">{t('billing.comparePlans')}</Link>} />
            {data && !data.configured ? <Alert severity="warning" title={t('billing.stubTitle')} testId="billing-stub">{t('billing.stubBody')}</Alert> : null}
            {message ? <Alert severity="info" testId="billing-message">{message}</Alert> : null}
            <div className="panel" data-testid="current-plan">
                <div className="stat-label">{t('billing.currentPlan')}</div>
                <div className="row" style={{ marginTop: 6 }}>
                    <span className="stat-value" style={{ marginTop: 0 }}>{data ? t(`pricing.plans.${data.plan}.name`) : '…'}</span>
                    <Badge variant="neutral" pill>{data?.status === 'none' || !data ? t('billing.none') : data.status}</Badge>
                </div>
                {data?.renewsAt ? <p className="muted">{t('billing.renews')}: {formatDate(data.renewsAt, locale)}</p> : null}
            </div>
            <div className="grid-2">
                {PLANS.filter(plan => PAID_PLANS.includes(plan.id)).map(plan => (
                    <div className={`panel plan-card${plan.highlighted ? ' highlight' : ''}`} key={plan.id} data-testid={`billing-plan-${plan.id}`}>
                        <h2>{t(`pricing.plans.${plan.id}.name`)}</h2>
                        <div className="plan-price">{plan.monthlyPriceUsd === null ? t('common.tbd') : formatUsd(plan.monthlyPriceUsd, locale)}</div>
                        <p className="muted" style={{ margin: 0 }}>{t(`pricing.plans.${plan.id}.desc`)}</p>
                        <ul>{plan.featureKeys.map(key => <li key={key}>{t(`pricing.features.${key}`)}</li>)}</ul>
                        <Button variant={plan.highlighted ? 'primary' : 'outline'} disabled={data?.plan === plan.id} loading={busy === plan.id} onClick={() => upgrade(plan.id)} testId={`upgrade-${plan.id}`}>
                            {t('billing.upgrade', { plan: t(`pricing.plans.${plan.id}.name`) })}
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}
