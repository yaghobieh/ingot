import Link from 'next/link';
import { ROUTES } from '@/constants/app.consts';
import { SiteHeader } from '@components/SiteHeader';
import { getT } from '@i18n/server';
import { getCurrentUser } from '@server/http/auth';

export const dynamic = 'force-dynamic';

const FEATURES = [
    { key: 'agents', icon: '⌘' },
    { key: 'models', icon: '◈' },
    { key: 'keymap', icon: '⇧' },
    { key: 'plugins', icon: '⬢' },
    { key: 'rules', icon: '/' },
    { key: 'sync', icon: '⟲' }
] as const;

export default async function LandingPage() {
    const t = await getT();
    const user = await getCurrentUser().catch(() => undefined);
    return (
        <>
            <SiteHeader signedIn={Boolean(user)} />
            <main>
                <section className="hero container">
                    <span className="pill pill-gold">{t('landing.badge')}</span>
                    <h1 data-testid="hero-title">{t('landing.title')}</h1>
                    <p className="lead">{t('landing.subtitle')}</p>
                    <div className="row">
                        <Link href={ROUTES.signUp} className="btn-link btn-gold btn-lg" data-testid="cta-start">{t('landing.ctaPrimary')}</Link>
                        <Link href={ROUTES.pricing} className="btn-link btn-ghost btn-lg" data-testid="cta-pricing">{t('landing.ctaSecondary')}</Link>
                    </div>
                    <p className="muted">{t('landing.download')}</p>
                    <div className="hero-shot" aria-hidden>
                        <div className="hero-shot-inner" dir="ltr">
                            <div className="strip" />
                            <div className="tree">▾ ingot<br />&nbsp;&nbsp;▾ src<br />&nbsp;&nbsp;&nbsp;&nbsp;app.ts<br />&nbsp;&nbsp;&nbsp;&nbsp;agent.ts<br />&nbsp;&nbsp;.ingot<br />&nbsp;&nbsp;package.json</div>
                            <div className="editor">
                                <span className="tok-c">{'// agent.ts'}</span><br />
                                <span className="tok-k">export async function</span> <span className="tok-f">plan</span>(goal: <span className="tok-k">string</span>) {'{'}<br />
                                &nbsp;&nbsp;<span className="tok-k">const</span> steps = <span className="tok-k">await</span> agent.<span className="tok-f">think</span>(goal);<br />
                                &nbsp;&nbsp;<span className="tok-k">return</span> steps.<span className="tok-f">map</span>(s =&gt; s.<span className="tok-f">run</span>());<br />
                                {'}'}<br />
                                <span className="tok-s">{"'Search Everywhere ⇧⇧'"}</span>
                            </div>
                            <div className="agent">
                                <b>Agent</b> · Claude Sonnet 4.5<br /><br />
                                ✓ Read src/app.ts<br />✓ Plan 3 steps<br />◌ Edit agent.ts<br /><br />
                                <span className="tok-s">Accept</span> · <span className="tok-c">Reject</span>
                            </div>
                        </div>
                    </div>
                </section>
                <section className="section container">
                    <h2 className="title">{t('landing.featuresTitle')}</h2>
                    <div className="grid-3">
                        {FEATURES.map(feature => (
                            <div className="panel feature" key={feature.key} data-testid={`feature-${feature.key}`}>
                                <div className="feature-icon">{feature.icon}</div>
                                <h3>{t(`landing.features.${feature.key}.title`)}</h3>
                                <p>{t(`landing.features.${feature.key}.body`)}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>
            <footer className="site-footer">
                <div className="container row">
                    <span>© Ingot · {t('common.openSource')}</span>
                    <span className="spacer" />
                    <Link href={ROUTES.pricing}>{t('common.pricing')}</Link>
                    <a href="https://github.com/yaghobieh/ingot">GitHub</a>
                </div>
            </footer>
        </>
    );
}
