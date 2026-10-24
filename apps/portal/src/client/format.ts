import type { Locale } from '@/types/domain.types';

const COMPACT_THRESHOLD = 10_000;
const COST_DIGITS_SMALL = 4;
const COST_DIGITS = 2;
const SMALL_COST = 1;

export function formatNumber(value: number, locale: Locale): string {
    return new Intl.NumberFormat(locale, value >= COMPACT_THRESHOLD ? { notation: 'compact', maximumFractionDigits: 1 } : {}).format(value);
}

export function formatUsd(value: number, locale: Locale): string {
    const digits = value > 0 && value < SMALL_COST ? COST_DIGITS_SMALL : COST_DIGITS;
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: COST_DIGITS, maximumFractionDigits: digits }).format(value);
}

export function formatDate(iso: string, locale: Locale, withTime = false): string {
    return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso));
}

export function shortDay(day: string, locale: Locale): string {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}
