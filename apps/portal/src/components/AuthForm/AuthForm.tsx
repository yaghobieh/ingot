'use client';

import { Alert, Button } from '@forgedevstack/bear';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ROUTES } from '@/constants/app.consts';
import { api, errorCode } from '@/client/api';
import type { OAuthProvider } from '@/types/domain.types';
import type { AuthFormProps } from '@components/AuthForm/AuthForm.types';
import { usePortal } from '@components/Providers';

const OAUTH: OAuthProvider[] = ['github', 'google'];

export function AuthForm({ mode, providers, next, initialError }: AuthFormProps) {
    const { t } = usePortal();
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(initialError ?? '');
    const isSignUp = mode === 'sign-up';

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await api('/api/auth/otp/request', { method: 'POST', body: { email, name, purpose: mode } });
            router.push(`${ROUTES.verify}?${new URLSearchParams({ email, next }).toString()}`);
        } catch (err) {
            setError(errorCode(err));
            setBusy(false);
        }
    };

    return (
        <div className="panel auth-card stack" data-testid={`${mode}-card`}>
            <div>
                <h1 data-testid="page-title">{t(isSignUp ? 'auth.signUpTitle' : 'auth.signInTitle')}</h1>
                <p className="muted" style={{ margin: 0 }}>{t(isSignUp ? 'auth.signUpSubtitle' : 'auth.signInSubtitle')}</p>
            </div>
            {error ? <Alert severity="error" testId="auth-error">{t(`auth.errors.${error}`) === `auth.errors.${error}` ? t('auth.errors.generic') : t(`auth.errors.${error}`)}</Alert> : null}
            <div className="stack-sm">
                {OAUTH.map(provider => providers[provider] ? (
                    <a key={provider} className="btn-link btn-ghost" href={`/api/auth/oauth/${provider}?${new URLSearchParams({ next }).toString()}`} data-testid={`oauth-${provider}`}>
                        {t(`auth.${provider}`)}
                    </a>
                ) : (
                    <Button key={provider} variant="outline" disabled fullWidth tooltip={t('auth.notConfigured')} testId={`oauth-${provider}`}>
                        {t(`auth.${provider}`)} · <span className="muted">{t('auth.notConfigured')}</span>
                    </Button>
                ))}
            </div>
            <div className="divider">{t('auth.or')}</div>
            <form className="stack" onSubmit={submit}>
                {isSignUp ? (
                    <div className="field">
                        <label htmlFor="name">{t('auth.name')}</label>
                        <input id="name" className="input" value={name} onChange={event => setName(event.target.value)} autoComplete="name" data-testid="name-input" />
                    </div>
                ) : null}
                <div className="field">
                    <label htmlFor="email">{t('auth.email')}</label>
                    <input id="email" className="input" type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" data-testid="email-input" />
                </div>
                <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!providers.email} testId="send-code">{t('auth.sendCode')}</Button>
            </form>
            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
                {t(isSignUp ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
                <Link href={`${isSignUp ? ROUTES.signIn : ROUTES.signUp}?${new URLSearchParams({ next }).toString()}`} data-testid="switch-auth">
                    {t(isSignUp ? 'common.signIn' : 'common.signUp')}
                </Link>
            </p>
        </div>
    );
}
