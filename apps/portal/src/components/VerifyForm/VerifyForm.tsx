'use client';

import { Alert, Button } from '@forgedevstack/bear';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ROUTES } from '@/constants/app.consts';
import { api, errorCode } from '@/lib/api';
import { usePortal } from '@components/Providers';
import type { VerifyFormProps } from '@components/VerifyForm/VerifyForm.types';

const CODE_LENGTH = 6;

export function VerifyForm({ email, next }: VerifyFormProps) {
    const { t } = usePortal();
    const router = useRouter();
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            const result = await api<{ next: string }>('/api/auth/otp/verify', { method: 'POST', body: { email, code, next } });
            router.push(result.next);
            router.refresh();
        } catch (err) {
            setError(errorCode(err));
            setBusy(false);
        }
    };

    const resend = async () => {
        setError('');
        try {
            await api('/api/auth/otp/request', { method: 'POST', body: { email, purpose: 'sign-in' } });
            setInfo(t('auth.resent'));
        } catch (err) {
            setError(errorCode(err));
        }
    };

    const message = error ? (t(`auth.errors.${error}`) === `auth.errors.${error}` ? t('auth.errors.generic') : t(`auth.errors.${error}`)) : '';

    return (
        <div className="panel auth-card stack" data-testid="verify-card">
            <div>
                <h1 data-testid="page-title">{t('auth.verifyTitle')}</h1>
                <p className="muted" style={{ margin: 0 }}>{t('auth.verifySubtitle', { email })}</p>
            </div>
            {message ? <Alert severity="error" testId="verify-error">{message}</Alert> : null}
            {info ? <Alert severity="success" testId="verify-info">{info}</Alert> : null}
            <form className="stack" onSubmit={submit}>
                <div className="field">
                    <label htmlFor="code">{t('auth.code')}</label>
                    <input
                        id="code" className="input input-code" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH} required
                        value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} data-testid="code-input" dir="ltr"
                    />
                </div>
                <Button type="submit" variant="primary" fullWidth loading={busy} disabled={code.length !== CODE_LENGTH} testId="verify-submit">{t('auth.verify')}</Button>
            </form>
            <div className="row">
                <Button variant="ghost" size="sm" onClick={resend} testId="resend-code">{t('auth.resend')}</Button>
                <span className="spacer" />
                <Link href={ROUTES.signIn} data-testid="change-email">{t('auth.changeEmail')}</Link>
            </div>
        </div>
    );
}
