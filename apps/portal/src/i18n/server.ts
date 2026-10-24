import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_THEME, LOCALE_COOKIE, THEME_COOKIE, THEMES } from '@/constants/app.consts';
import type { Locale, ThemePreference } from '@/types/domain.types';
import type { Translate } from '@i18n/i18n.types';
import { resolveLocale, translate } from '@i18n/i18n.utils';

export async function getLocale(): Promise<Locale> {
    return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

export async function getThemePreference(): Promise<ThemePreference> {
    const value = (await cookies()).get(THEME_COOKIE)?.value;
    return value && (THEMES as string[]).includes(value) ? value as ThemePreference : DEFAULT_THEME;
}

export async function getT(): Promise<Translate> {
    const locale = await getLocale();
    return (key, params) => translate(locale, key, params);
}
