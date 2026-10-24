'use client';

import { Alert, Button } from '@forgedevstack/bear';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@/lib/api';
import { usePortal } from '@components/Providers';
import type { DeviceViewProps } from '@/views/views.types';

type Step = 'enter' | 'confirm' | 'approved' | 'denied';

export function DeviceView({ initialCode }: DeviceViewProps) {
    const { t } = usePortal();
    const [code, setCode] = useState(initialCode);
    const [client, setClient] = useState('');
    const [step, setStep] = useState<Step>('enter');
    const [invalid, setInvalid] = useState(false);
    const [busy, setBusy] = useState(false);

    const lookup = async (event: FormEvent) => {
        event.preventDefault();
        setInvalid(false);
        setBusy(true);
        try {
            const result = await api<{ clientName: string }>(`/api/device/lookup?code=${encodeURIComponent(code)}`);
            setClient(result.clientName);
            setStep('confirm');
        } catch {
            setInvalid(true);
        }
        setBusy(false);
    };

    const decide = async (approve: boolean) => {
        setBusy(true);
        try {
            await api('/api/device/decision', { method: 'POST', body: { code, approve } });
            setStep(approve ? 'approved' : 'denied');
        } catch {
            setInvalid(true);
            setStep('enter');
        }
        setBusy(false);
    };

    return (
        <div className="panel auth-card stack" data-testid="device-card">
            <div>
                <h1 data-testid="page-title">{t('device.title')}</h1>
                <p className="muted" style={{ margin: 0 }}>{t('device.subtitle')}</p>
            </div>
            {invalid ? <Alert severity="error" testId="device-invalid">{t('device.invalid')}</Alert> : null}
            {step === 'enter' ? (
                <form className="stack" onSubmit={lookup}>
                    <div className="field">
                        <label htmlFor="device-code">{t('device.code')}</label>
                        <input id="device-code" className="input input-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={9} placeholder="ABCD-EFGH" required data-testid="device-code" dir="ltr" />
                    </div>
                    <Button type="submit" variant="primary" fullWidth loading={busy} testId="device-lookup">{t('device.lookup')}</Button>
                </form>
            ) : null}
            {step === 'confirm' ? (
                <div className="stack" data-testid="device-confirm">
                    <div className="notice">{t('device.confirm', { client })}</div>
                    <div className="secret-box" dir="ltr"><code>{code}</code></div>
                    <div className="row">
                        <Button variant="primary" loading={busy} onClick={() => decide(true)} testId="device-approve">{t('device.approve')}</Button>
                        <Button variant="outline" disabled={busy} onClick={() => decide(false)} testId="device-deny">{t('device.deny')}</Button>
                    </div>
                </div>
            ) : null}
            {step === 'approved' ? <Alert severity="success" testId="device-approved">{t('device.approved')}</Alert> : null}
            {step === 'denied' ? <Alert severity="info" testId="device-denied">{t('device.denied')}</Alert> : null}
        </div>
    );
}
