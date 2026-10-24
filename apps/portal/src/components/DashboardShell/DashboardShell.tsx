'use client';

import { Badge, Button } from '@forgedevstack/bear';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ROUTES } from '@/constants/app.consts';
import { api } from '@/client/api';
import { DASHBOARD_NAV } from '@components/DashboardShell/DashboardShell.consts';
import type { DashboardShellProps } from '@components/DashboardShell/DashboardShell.types';
import { LocaleSelect } from '@components/LocaleSelect';
import { Logo } from '@components/Logo';
import { usePortal } from '@components/Providers';
import { ThemeToggle } from '@components/ThemeToggle';

function initials(name: string, email: string): string {
    const source = name.trim() || email;
    return source.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('');
}

export function DashboardShell({ user, children }: DashboardShellProps) {
    const { t } = usePortal();
    const pathname = usePathname();
    const router = useRouter();

    const signOut = async () => {
        await api('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined);
        router.push(ROUTES.home);
        router.refresh();
    };

    return (
        <div className="shell">
            <aside className="sidebar" data-testid="sidebar">
                <Logo href={ROUTES.dashboard} />
                {DASHBOARD_NAV.map(item => (
                    <Link key={item.href} href={item.href} data-testid={item.testId} className={`side-link${pathname === item.href ? ' active' : ''}`}>
                        <span className="side-icon" aria-hidden>{item.icon}</span>{t(item.key)}
                    </Link>
                ))}
                <div className="sidebar-foot">
                    <Link href={ROUTES.device} className="side-link" data-testid="nav-device"><span className="side-icon" aria-hidden>⌁</span>{t('overview.connectIde')}</Link>
                </div>
            </aside>
            <div className="main">
                <div className="topbar">
                    <Badge variant="neutral" pill testId="plan-badge">{t(`pricing.plans.${user.plan}.name`)}</Badge>
                    <span className="spacer" />
                    <LocaleSelect />
                    <ThemeToggle />
                    <span className="avatar" aria-hidden>{initials(user.name, user.email)}</span>
                    <span className="muted" data-testid="user-email">{user.email}</span>
                    <Button variant="ghost" size="sm" onClick={signOut} testId="sign-out">{t('common.signOut')}</Button>
                </div>
                <main className="content">{children}</main>
            </div>
        </div>
    );
}
