'use client';

import { LOCALES } from '@/constants/app.consts';
import type { Locale } from '@/types/domain.types';
import { LOCALE_NAMES } from '@components/LocaleSelect/LocaleSelect.consts';
import { usePortal } from '@components/Providers';

export function LocaleSelect() {
    const { locale, setLocale, t } = usePortal();
    return (
        <select className="select select-sm" aria-label={t('common.language')} data-testid="locale-select" value={locale} onChange={event => setLocale(event.target.value as Locale)}>
            {LOCALES.map(code => <option key={code} value={code}>{LOCALE_NAMES[code]}</option>)}
        </select>
    );
}
