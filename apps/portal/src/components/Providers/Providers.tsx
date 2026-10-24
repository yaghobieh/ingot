'use client';

import { BearProvider } from '@forgedevstack/bear';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { COOKIE_MAX_AGE_YEAR, LOCALE_COOKIE, THEME_COOKIE } from '@/constants/app.consts';
import { api } from '@/lib/api';
import type { Locale, ThemePreference } from '@/types/domain.types';
import type { PortalContextValue, ProvidersProps, ResolvedTheme } from '@components/Providers/Providers.types';
import { directionFor, translate } from '@i18n/i18n.utils';

const PortalContext = createContext<PortalContextValue | null>(null);
const DARK_QUERY = '(prefers-color-scheme: dark)';

function setCookie(name: string, value: string) {
    document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE_YEAR}; samesite=lax`;
}

function resolve(theme: ThemePreference): ResolvedTheme {
    if (theme !== 'system') { return theme; }
    return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function Providers({ locale, theme: initialTheme, signedIn, children }: ProvidersProps) {
    const router = useRouter();
    const [theme, setThemeState] = useState<ThemePreference>(initialTheme);
    const [resolvedTheme, setResolved] = useState<ResolvedTheme>(initialTheme === 'dark' ? 'dark' : 'light');

    useEffect(() => {
        const apply = () => {
            const next = resolve(theme);
            setResolved(next);
            document.documentElement.dataset.theme = next;
        };
        apply();
        const media = window.matchMedia(DARK_QUERY);
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [theme]);

    const setTheme = useCallback((next: ThemePreference) => {
        setCookie(THEME_COOKIE, next);
        setThemeState(next);
        if (signedIn) { void api('/api/me', { method: 'PATCH', body: { theme: next } }).catch(() => undefined); }
    }, [signedIn]);

    const setLocale = useCallback((next: Locale) => {
        setCookie(LOCALE_COOKIE, next);
        document.documentElement.lang = next;
        document.documentElement.dir = directionFor(next);
        if (signedIn) { void api('/api/me', { method: 'PATCH', body: { locale: next } }).catch(() => undefined); }
        router.refresh();
    }, [router, signedIn]);

    const value = useMemo<PortalContextValue>(() => ({
        locale, theme, resolvedTheme, setTheme, setLocale,
        t: (key, params) => translate(locale, key, params)
    }), [locale, theme, resolvedTheme, setTheme, setLocale]);

    return (
        <PortalContext.Provider value={value}>
            <BearProvider mode={resolvedTheme} direction={directionFor(locale)} persistPreference={false}>
                <div className="ingot-root">{children}</div>
            </BearProvider>
        </PortalContext.Provider>
    );
}

export function usePortal(): PortalContextValue {
    const value = useContext(PortalContext);
    if (!value) { throw new Error('usePortal must be used inside <Providers>'); }
    return value;
}
