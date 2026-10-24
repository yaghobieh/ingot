'use client';

import { Alert, Button } from '@forgedevstack/bear';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROUTES } from '@/constants/app.consts';
import { api, errorCode } from '@/client/api';
import { usePortal } from '@components/Providers';
import type { InviteViewProps } from '@/views/views.types';

export function InviteView({ token, invite, userEmail }: InviteViewProps) {
    const { t } = usePortal();
    const router = useRouter();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const accept = async () => {
        setBusy(true);
        try {
            await api('/api/team/accept', { method: 'POST', body: { token } });
            router.push(ROUTES.team);
            router.refresh();
        } catch (err) {
            setError(errorCode(err));
            setBusy(false);
        }
    };

    if (!invite) {
        return <div className="panel auth-card"><Alert severity="error" testId="invite-invalid">{t('invite.invalid')}</Alert></div>;
    }
    const next = `/invite/${token}`;
    return (
        <div className="panel auth-card stack" data-testid="invite-card">
            <h1 data-testid="page-title">{t('invite.title')}</h1>
            <p style={{ margin: 0 }}>{t('invite.body', { team: invite.teamName, role: t(`team.roles.${invite.role}`) })}</p>
            {error ? <Alert severity="error" testId="invite-error">{error === 'invite_email_mismatch' ? t('invite.wrongEmail', { email: invite.email }) : t('errors.generic')}</Alert> : null}
            {!userEmail ? (
                <Link className="btn-link btn-primary" href={`${ROUTES.signIn}?next=${encodeURIComponent(next)}`} data-testid="invite-sign-in">{t('invite.signIn')}</Link>
            ) : userEmail !== invite.email ? (
                <Alert severity="warning" testId="invite-wrong-email">{t('invite.wrongEmail', { email: invite.email })}</Alert>
            ) : (
                <Button variant="primary" loading={busy} onClick={accept} testId="invite-accept">{t('invite.accept')}</Button>
            )}
        </div>
    );
}
