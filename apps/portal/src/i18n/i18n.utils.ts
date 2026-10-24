import { DEFAULT_LOCALE, LOCALES, RTL_LOCALES } from '@/constants/app.consts';
import type { Locale } from '@/types/domain.types';
import type { Messages, TranslateParams } from '@i18n/i18n.types';
import { en } from '@i18n/messages/en';
import { es } from '@i18n/messages/es';
import { he } from '@i18n/messages/he';

export const MESSAGES: Record<Locale, Messages> = { en, he, es };

export function resolveLocale(value: string | undefined | null): Locale {
    return value && (LOCALES as string[]).includes(value) ? value as Locale : DEFAULT_LOCALE;
}

export function directionFor(locale: Locale): 'rtl' | 'ltr' {
    return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

function lookup(messages: unknown, key: string): string | undefined {
    const value = key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);
    return typeof value === 'string' ? value : undefined;
}

/** Looks up a dotted key, falls back to English, then to the key itself; fills {params}. */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
    const template = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key) ?? key;
    return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}

export function flattenKeys(node: unknown, prefix = ''): string[] {
    if (typeof node !== 'object' || node === null) { return [prefix]; }
    return Object.entries(node).flatMap(([key, value]) => flattenKeys(value, prefix ? `${prefix}.${key}` : key));
}
