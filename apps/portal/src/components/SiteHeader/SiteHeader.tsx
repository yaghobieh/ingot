'use client';

import Link from 'next/link';
import { ROUTES } from '@/constants/app.consts';
import { LocaleSelect } from '@components/LocaleSelect';
import { Logo } from '@components/Logo';
import { usePortal } from '@components/Providers';
import type { SiteHeaderProps } from '@components/SiteHeader/SiteHeader.types';
import { ThemeToggle } from '@components/ThemeToggle';

export function SiteHeader({ signedIn }: SiteHeaderProps) {
    const { t } = usePortal();
    return (
        <header className="site-header">
            <div className="site-header-inner">
                <Logo />
                <nav>
                    <Link href={ROUTES.pricing} data-testid="nav-pricing">{t('common.pricing')}</Link>
                </nav>
                <span className="spacer" />
                <LocaleSelect />
                <ThemeToggle />
                {signedIn ? (
                    <Link className="btn-link btn-primary" href={ROUTES.dashboard} data-testid="nav-dashboard">{t('common.dashboard')}</Link>
                ) : (
                    <>
                        <Link className="btn-link btn-ghost" href={ROUTES.signIn} data-testid="nav-sign-in">{t('common.signIn')}</Link>
                        <Link className="btn-link btn-primary" href={ROUTES.signUp} data-testid="nav-sign-up">{t('common.getStarted')}</Link>
                    </>
                )}
            </div>
        </header>
    );
}
