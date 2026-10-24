'use client';

import { Alert, Badge, Button } from '@forgedevstack/bear';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { INVITABLE_ROLES } from '@/constants/app.consts';
import { api, errorCode } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { TeamInfo, TeamRole } from '@/types/domain.types';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';
import type { TeamViewProps } from '@/views/views.types';

export function TeamView({ me }: TeamViewProps) {
    const { t, locale } = usePortal();
    const { data, setData } = useApi<{ team: TeamInfo | null }>('/api/team');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<TeamRole>('member');
    const [link, setLink] = useState('');
    const [error, setError] = useState('');
    const team = data?.team;
    const canInvite = team?.myRole === 'owner' || team?.myRole === 'admin';

    const run = async (action: () => Promise<{ team: TeamInfo | null; link?: string }>) => {
        setError('');
        try {
            const result = await action();
            setData({ team: result.team });
            if (result.link) { setLink(result.link); }
        } catch (err) {
            setError(errorCode(err));
        }
    };

    const create = (event: FormEvent) => {
        event.preventDefault();
        void run(() => api('/api/team', { method: 'POST', body: { name } }));
    };

    const invite = (event: FormEvent) => {
        event.preventDefault();
        void run(async () => {
            const result = await api<{ team: TeamInfo; link: string }>('/api/team/invites', { method: 'POST', body: { email, role } });
            setEmail('');
            return result;
        });
    };

    const errorText = error ? (t(`errors.${error}`) === `errors.${error}` ? t('errors.generic') : t(`errors.${error}`)) : '';

    return (
        <div className="stack">
            <PageHeader title={t('team.title')} subtitle={team ? team.name : undefined} />
            {errorText ? <Alert severity="error" testId="team-error">{errorText}</Alert> : null}
            {data && !team ? (
                <form className="panel stack" onSubmit={create} data-testid="create-team">
                    <div><h2>{t('team.noTeamTitle')}</h2><p className="muted" style={{ margin: 0 }}>{t('team.noTeamBody')}</p></div>
                    <div className="row-wrap">
                        <input className="input" placeholder={t('team.teamName')} aria-label={t('team.teamName')} value={name} onChange={e => setName(e.target.value)} required maxLength={80} data-testid="team-name" />
                        <Button type="submit" variant="primary" testId="create-team-submit">{t('team.create')}</Button>
                    </div>
                </form>
            ) : null}
            {team ? (
                <>
                    {canInvite ? (
                        <form className="panel stack" onSubmit={invite} data-testid="invite-form">
                            <h2>{t('team.invite')}</h2>
                            <div className="row-wrap">
                                <input className="input" type="email" placeholder={t('team.inviteEmail')} aria-label={t('team.inviteEmail')} value={email} onChange={e => setEmail(e.target.value)} required data-testid="invite-email" style={{ flex: 1 }} />
                                <select className="select" aria-label={t('team.role')} value={role} onChange={e => setRole(e.target.value as TeamRole)} data-testid="invite-role">
                                    {INVITABLE_ROLES.filter(r => team.myRole === 'owner' || r === 'member').map(r => <option key={r} value={r}>{t(`team.roles.${r}`)}</option>)}
                                </select>
                                <Button type="submit" variant="primary" testId="send-invite">{t('team.sendInvite')}</Button>
                            </div>
                            {link ? <div className="stack-sm" data-testid="invite-link"><span className="muted">{t('team.inviteSent')}</span><div className="secret-box"><code>{link}</code></div></div> : null}
                        </form>
                    ) : null}
                    <div className="panel table-wrap">
                        <div className="panel-head"><h2>{t('team.members')}</h2></div>
                        <table className="data" data-testid="members-table">
                            <tbody>
                                {team.members.map(member => (
                                    <tr key={member.userId} data-testid={`member-${member.email}`}>
                                        <td><b>{member.name || member.email}</b>{member.userId === me.id ? <span className="muted"> ({t('team.you')})</span> : null}</td>
                                        <td className="muted">{member.email}</td>
                                        <td>
                                            {team.myRole === 'owner' && member.role !== 'owner' ? (
                                                <select className="select select-sm" aria-label={t('team.role')} value={member.role} data-testid={`role-${member.email}`}
                                                    onChange={e => void run(() => api(`/api/team/members/${member.userId}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                                                    {INVITABLE_ROLES.map(r => <option key={r} value={r}>{t(`team.roles.${r}`)}</option>)}
                                                </select>
                                            ) : <Badge variant={member.role === 'owner' ? 'warning' : 'neutral'} pill>{t(`team.roles.${member.role}`)}</Badge>}
                                        </td>
                                        <td className="num">
                                            {member.role !== 'owner' && member.userId !== me.id && (team.myRole === 'owner' || (team.myRole === 'admin' && member.role === 'member')) ? (
                                                <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/api/team/members/${member.userId}`, { method: 'DELETE' }))} testId={`remove-${member.email}`}>{t('team.remove')}</Button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {canInvite && team.invites.length > 0 ? (
                        <div className="panel table-wrap" data-testid="pending-invites">
                            <div className="panel-head"><h2>{t('team.pending')}</h2></div>
                            <table className="data">
                                <tbody>
                                    {team.invites.map(inv => (
                                        <tr key={inv.id} data-testid={`invite-${inv.email}`}>
                                            <td>{inv.email}</td>
                                            <td><Badge variant="neutral" pill>{t(`team.roles.${inv.role}`)}</Badge></td>
                                            <td className="muted">{t('team.expires')} {formatDate(inv.expiresAt, locale)}</td>
                                            <td className="num"><Button size="sm" variant="ghost" onClick={() => void run(() => api(`/api/team/invites/${inv.id}`, { method: 'DELETE' }))} testId={`revoke-invite-${inv.email}`}>{t('team.revokeInvite')}</Button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
