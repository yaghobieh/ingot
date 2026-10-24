import { describe, expect, it } from 'vitest';
import { directionFor, flattenKeys, MESSAGES, resolveLocale, translate } from '@i18n/i18n.utils';

describe('i18n', () => {
    it('has the same keys in every locale', () => {
        const base = flattenKeys(MESSAGES.en).sort();
        expect(flattenKeys(MESSAGES.he).sort()).toEqual(base);
        expect(flattenKeys(MESSAGES.es).sort()).toEqual(base);
    });
    it('has no empty strings', () => {
        for (const locale of ['en', 'he', 'es'] as const) {
            expect(flattenKeys(MESSAGES[locale]).every(key => translate(locale, key).trim().length > 0)).toBe(true);
        }
    });
    it('interpolates params and falls back', () => {
        expect(translate('en', 'overview.range', { days: 7 })).toBe('Last 7 days');
        expect(translate('es', 'missing.key')).toBe('missing.key');
    });
    it('resolves locale and direction', () => {
        expect(resolveLocale('he')).toBe('he');
        expect(resolveLocale('fr')).toBe('en');
        expect(directionFor('he')).toBe('rtl');
        expect(directionFor('es')).toBe('ltr');
    });
    it('never names an AI provider company in UI copy', () => {
        const all = (['en', 'he', 'es'] as const).flatMap(locale => flattenKeys(MESSAGES[locale]).map(key => translate(locale, key))).join(' ');
        expect(all).not.toMatch(/\b(Anthropic|OpenAI|Mistral AI|DeepMind|OpenRouter|Together AI|Fireworks)\b/);
    });
});
