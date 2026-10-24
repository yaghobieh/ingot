import type { Metadata } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/constants/app.consts';
import { PLANS } from '@/constants/plans.consts';
import { SiteHeader } from '@components/SiteHeader';
import { getLocale, getT } from '@i18n/server';
import { getCurrentUser } from '@server/http/auth';
import { formatUsd } from '@/client/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pricing' };

export default async function PricingPage() {
    const [t, locale] = await Promise.all([getT(), getLocale()]);
    const user = await getCurrentUser().catch(() => undefined);
    return (
        <>
            <SiteHeader signedIn={Boolean(user)} />
            <main className="container section">
                <div className="hero" style={{ padding: '24px 0 32px' }}>
                    <h1 data-testid="page-title">{t('pricing.title')}</h1>
                    <p className="lead">{t('pricing.subtitle')}</p>
                </div>
                <div className="grid-3">
                    {PLANS.map(plan => (
                        <div key={plan.id} className={`panel plan-card${plan.highlighted ? ' highlight' : ''}`} data-testid={`plan-${plan.id}`}>
                            <div className="row">
                                <h2 style={{ fontSize: 18 }}>{t(`pricing.plans.${plan.id}.name`)}</h2>
                                {plan.highlighted ? <span className="pill pill-gold">{t('pricing.popular')}</span> : null}
                            </div>
                            <div className="plan-price" data-testid={`price-${plan.id}`}>
                                {plan.monthlyPriceUsd === null ? t('common.tbd') : formatUsd(plan.monthlyPriceUsd, locale)}
                                {plan.monthlyPriceUsd === null ? null : <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}> {t('common.perMonth')}</span>}
                            </div>
                            <p className="muted" style={{ margin: 0 }}>{t(`pricing.plans.${plan.id}.desc`)}</p>
                            <ul>{plan.featureKeys.map(key => <li key={key}>{t(`pricing.features.${key}`)}</li>)}</ul>
                            <span className="spacer" />
                            <Link
                                href={user ? ROUTES.billing : `${ROUTES.signUp}?plan=${plan.id}`}
                                className={`btn-link ${plan.highlighted ? 'btn-gold' : 'btn-ghost'}`}
                                data-testid={`cta-${plan.id}`}
                            >
                                {t(`pricing.plans.${plan.id}.cta`)}
                            </Link>
                        </div>
                    ))}
                </div>
                <p className="muted" style={{ textAlign: 'center', marginTop: 24 }} data-testid="tbd-note">{t('pricing.tbdNote')}</p>
            </main>
        </>
    );
}
