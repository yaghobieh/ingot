import type { ReactNode } from 'react';
import type { TranslateParams } from '@i18n/i18n.types';
import type { Locale, ThemePreference } from '@/types/domain.types';

export type ResolvedTheme = 'light' | 'dark';

export interface PortalContextValue {
    locale: Locale;
    theme: ThemePreference;
    resolvedTheme: ResolvedTheme;
    t: (key: string, params?: TranslateParams) => string;
    setLocale: (locale: Locale) => void;
    setTheme: (theme: ThemePreference) => void;
}

export interface ProvidersProps {
    locale: Locale;
    theme: ThemePreference;
    signedIn: boolean;
    children: ReactNode;
}
