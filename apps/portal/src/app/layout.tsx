import '@forgedevstack/bear/styles.css';
import '@/app/tokens.css';
import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { THEME_COOKIE } from '@/constants/app.consts';
import { Providers } from '@components/Providers';
import { directionFor } from '@i18n/i18n.utils';
import { getLocale, getThemePreference } from '@i18n/server';
import { getCurrentUser } from '@server/http/auth';

export const metadata: Metadata = {
    title: { default: 'Ingot', template: '%s · Ingot' },
    description: 'Ingot - the open-source AI IDE. Account, usage, billing and team portal.'
};

/** Applies the system theme before first paint to avoid a flash. */
const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);var p=m?m[1]:'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

async function safeUser() {
    try {
        return await getCurrentUser();
    } catch {
        return undefined;
    }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
    const [locale, theme, user] = await Promise.all([getLocale(), getThemePreference(), safeUser()]);
    return (
        <html lang={locale} dir={directionFor(locale)} data-theme={theme === 'dark' ? 'dark' : 'light'} suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
            </head>
            <body>
                <Providers locale={locale} theme={theme} signedIn={Boolean(user)}>{children}</Providers>
            </body>
        </html>
    );
}
