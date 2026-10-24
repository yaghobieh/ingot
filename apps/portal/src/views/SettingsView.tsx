'use client';

import { Alert, Button } from '@forgedevstack/bear';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { THEMES } from '@/constants/app.consts';
import { api } from '@/client/api';
import { formatDate } from '@/client/format';
import { useApi } from '@/client/useApi';
import type { SyncedSettings } from '@/types/domain.types';
import { LocaleSelect } from '@components/LocaleSelect';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';
import type { SettingsViewProps } from '@/views/views.types';

export function SettingsView({ user }: SettingsViewProps) {
    const { t, theme, setTheme, locale } = usePortal();
    const router = useRouter();
    const [name, setName] = useState(user.name);
    const [saved, setSaved] = useState(false);
    const sync = useApi<SyncedSettings>('/api/settings');

    const saveProfile = async (event: FormEvent) => {
        event.preventDefault();
        await api('/api/me', { method: 'PATCH', body: { name } });
        setSaved(true);
        router.refresh();
    };

    return (
        <div className="stack">
            <PageHeader title={t('settings.title')} />
            <form className="panel stack" onSubmit={saveProfile} data-testid="profile-form">
                <h2>{t('settings.profile')}</h2>
                {saved ? <Alert severity="success" testId="profile-saved">{t('common.saved')}</Alert> : null}
                <div className="grid-2">
                    <div className="field">
                        <label htmlFor="profile-name">{t('settings.name')}</label>
                        <input id="profile-name" className="input" value={name} onChange={e => { setName(e.target.value); setSaved(false); }} maxLength={120} data-testid="profile-name" />
                    </div>
                    <div className="field">
                        <label htmlFor="profile-email">{t('settings.email')}</label>
                        <input id="profile-email" className="input" value={user.email} disabled />
                    </div>
                </div>
                <div><Button type="submit" variant="primary" testId="save-profile">{t('common.save')}</Button></div>
            </form>
            <div className="panel stack" data-testid="appearance">
                <h2>{t('settings.appearance')}</h2>
                <div className="row-wrap">
                    <span className="stat-label" style={{ minWidth: 90 }}>{t('common.theme')}</span>
                    <div className="seg" role="group" data-testid="theme-picker">
                        {THEMES.map(option => (
                            <button key={option} type="button" aria-pressed={theme === option} onClick={() => setTheme(option)} data-testid={`theme-${option}`}>{t(`common.${option}`)}</button>
                        ))}
                    </div>
                </div>
                <div className="row-wrap">
                    <span className="stat-label" style={{ minWidth: 90 }}>{t('common.language')}</span>
                    <LocaleSelect />
                    <code className="muted">{locale}</code>
                </div>
            </div>
            <div className="panel stack" data-testid="sync-panel">
                <h2>{t('settings.syncTitle')}</h2>
                <p className="muted" style={{ margin: 0 }}>{t('settings.syncBody', { version: sync.data?.version ?? 0 })}</p>
                {sync.data && sync.data.version > 0 ? <p className="muted" style={{ margin: 0 }}>{t('settings.lastSync')}: {formatDate(sync.data.updatedAt, locale, true)}</p> : null}
                <pre className="secret-box mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }} data-testid="sync-json" dir="ltr">{JSON.stringify(sync.data?.data ?? {}, null, 2)}</pre>
            </div>
        </div>
    );
}
