'use client';

import { Alert, Button } from '@forgedevstack/bear';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { KEY_FAMILIES, KEY_FAMILY_LABELS } from '@/constants/models.consts';
import { api, errorCode } from '@/client/api';
import { formatDate } from '@/client/format';
import { useApi } from '@/client/useApi';
import type { AccessTokenInfo, KeyFamily, ProviderKeyInfo } from '@/types/domain.types';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';

export function KeysView() {
    const { t, locale } = usePortal();
    const tokens = useApi<{ tokens: AccessTokenInfo[] }>('/api/tokens');
    const keys = useApi<{ keys: ProviderKeyInfo[] }>('/api/keys');
    const [tokenName, setTokenName] = useState('');
    const [newToken, setNewToken] = useState('');
    const [copied, setCopied] = useState(false);
    const [family, setFamily] = useState<KeyFamily>('claude');
    const [label, setLabel] = useState('');
    const [secret, setSecret] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [error, setError] = useState('');

    const createToken = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        try {
            const result = await api<{ token: string }>('/api/tokens', { method: 'POST', body: { name: tokenName } });
            setNewToken(result.token);
            setCopied(false);
            setTokenName('');
            await tokens.reload();
        } catch (err) {
            setError(errorCode(err));
        }
    };

    const revoke = async (id: string) => {
        await api(`/api/tokens/${id}`, { method: 'DELETE' });
        await tokens.reload();
    };

    const copyToken = async () => {
        await navigator.clipboard?.writeText(newToken).catch(() => undefined);
        setCopied(true);
    };

    const addKey = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        try {
            await api('/api/keys', { method: 'POST', body: { family, label, secret, baseUrl } });
            setSecret('');
            setLabel('');
            setBaseUrl('');
            await keys.reload();
        } catch (err) {
            setError(errorCode(err));
        }
    };

    const removeKey = async (id: string) => {
        await api(`/api/keys/${id}`, { method: 'DELETE' });
        await keys.reload();
    };

    return (
        <div className="stack">
            <PageHeader title={t('keys.title')} />
            {error ? <Alert severity="error" testId="keys-error">{t(`errors.${error}`) === `errors.${error}` ? t('errors.generic') : t(`errors.${error}`)}</Alert> : null}

            <section className="panel" data-testid="tokens-panel">
                <div className="panel-head"><div><h2>{t('keys.tokensTitle')}</h2><p className="muted">{t('keys.tokensBody')}</p></div></div>
                <form className="row-wrap" onSubmit={createToken}>
                    <input className="input" placeholder={t('keys.tokenName')} aria-label={t('keys.tokenName')} value={tokenName} onChange={e => setTokenName(e.target.value)} required maxLength={80} data-testid="token-name" />
                    <Button type="submit" variant="primary" testId="create-token">{t('keys.createToken')}</Button>
                </form>
                {newToken ? (
                    <div className="stack-sm" style={{ marginTop: 16 }} data-testid="new-token">
                        <Alert severity="warning">{t('keys.newToken')}</Alert>
                        <div className="secret-box"><code className="spacer" data-testid="new-token-value">{newToken}</code>
                            <Button size="sm" variant="outline" onClick={copyToken} testId="copy-token">{copied ? t('common.copied') : t('common.copy')}</Button>
                        </div>
                    </div>
                ) : null}
                <div className="table-wrap" style={{ marginTop: 16 }}>
                    {tokens.data?.tokens.length === 0 ? <p className="muted">{t('keys.noTokens')}</p> : (
                        <table className="data" data-testid="tokens-table">
                            <thead><tr><th>{t('keys.tokenName')}</th><th>{t('keys.prefix')}</th><th>{t('keys.source')}</th><th>{t('keys.lastUsed')}</th><th>{t('keys.created')}</th><th /></tr></thead>
                            <tbody>
                                {tokens.data?.tokens.map(token => (
                                    <tr key={token.id}>
                                        <td>{token.name}</td>
                                        <td><code>{token.prefix}…</code></td>
                                        <td>{t(`keys.sources.${token.source}`)}</td>
                                        <td>{token.lastUsedAt ? formatDate(token.lastUsedAt, locale, true) : t('common.never')}</td>
                                        <td>{formatDate(token.createdAt, locale)}</td>
                                        <td className="num"><Button size="sm" variant="ghost" onClick={() => revoke(token.id)} testId={`revoke-${token.name}`}>{t('keys.revoke')}</Button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            <section className="panel" data-testid="byok-panel">
                <div className="panel-head"><div><h2>{t('keys.byokTitle')}</h2><p className="muted">{t('keys.byokBody')}</p></div></div>
                <form className="grid-4" onSubmit={addKey}>
                    <div className="field">
                        <label htmlFor="family">{t('keys.family')}</label>
                        <select id="family" className="select" value={family} onChange={e => setFamily(e.target.value as KeyFamily)} data-testid="key-family">
                            {KEY_FAMILIES.map(f => <option key={f} value={f}>{KEY_FAMILY_LABELS[f]}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="key-label">{t('keys.label')}</label>
                        <input id="key-label" className="input" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} data-testid="key-label" />
                    </div>
                    <div className="field">
                        <label htmlFor="key-secret">{t('keys.secret')}</label>
                        <input id="key-secret" className="input" type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} required data-testid="key-secret" />
                    </div>
                    {family === 'custom' ? (
                        <div className="field">
                            <label htmlFor="key-base">{t('keys.baseUrl')}</label>
                            <input id="key-base" className="input" type="url" placeholder="https://" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} required data-testid="key-base-url" />
                        </div>
                    ) : null}
                    <div className="field" style={{ justifyContent: 'flex-end' }}>
                        <Button type="submit" variant="primary" testId="save-key">{t('keys.addKey')}</Button>
                    </div>
                </form>
                <div className="table-wrap" style={{ marginTop: 16 }}>
                    {keys.data?.keys.length === 0 ? <p className="muted">{t('keys.noKeys')}</p> : (
                        <table className="data" data-testid="keys-table">
                            <tbody>
                                {keys.data?.keys.map(key => (
                                    <tr key={key.id}>
                                        <td><b>{key.label}</b></td>
                                        <td>{KEY_FAMILY_LABELS[key.family]}</td>
                                        <td><code data-testid="key-masked">••••{key.last4}</code> <span className="muted">{t('keys.ending', { last4: key.last4 })}</span></td>
                                        <td>{key.baseUrl ? <code>{key.baseUrl}</code> : null}</td>
                                        <td>{formatDate(key.createdAt, locale)}</td>
                                        <td className="num"><Button size="sm" variant="ghost" onClick={() => removeKey(key.id)} testId={`delete-key-${key.label}`}>{t('common.delete')}</Button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>
        </div>
    );
}
