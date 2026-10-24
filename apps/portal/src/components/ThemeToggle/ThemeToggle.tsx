'use client';

import { usePortal } from '@components/Providers';

/** One click flips light/dark (the resolved theme); Settings offers Light / Dark / System. */
export function ThemeToggle() {
    const { resolvedTheme, setTheme, t } = usePortal();
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    return (
        <button type="button" className="icon-btn" aria-label={t('common.toggleTheme')} title={t('common.toggleTheme')} data-testid="theme-toggle" data-theme-current={resolvedTheme} onClick={() => setTheme(next)}>
            {resolvedTheme === 'dark' ? '☀' : '☾'}
        </button>
    );
}
