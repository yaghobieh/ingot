import * as React from '@theia/core/shared/react';
import { SLACK_TEXT } from '../../common/slack';
import type { SlackConnectionCardProps } from './slack-connection-card.types';

/** IDEA-270: Slack connection card on the MCP page: status, one-time token, Connect / Disconnect. */
export const SlackConnectionCard = ({ service, onOpenApps, connectRequest }: SlackConnectionCardProps): React.ReactElement => {
    const [editing, setEditing] = React.useState(!!connectRequest);
    const [token, setToken] = React.useState('');
    const [error, setError] = React.useState<string>();
    const [busy, setBusy] = React.useState(false);
    const view = service.view;

    React.useEffect(() => {
        if (connectRequest) {
            setEditing(true);
        }
    }, [connectRequest]);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
            await service.connect(token);
            setToken('');
            setEditing(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };
    const run = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        try {
            await action();
        } finally {
            setBusy(false);
        }
    };

    const showConnect = !editing && (view.state === 'disconnected' || view.state === 'needs-token' || view.state === 'error');
    return <section className='ingot-slack-card' id='ingot-slack-card' data-state={view.state}>
        <div className='ingot-slack-head'>
            <span className='ingot-slack-icon codicon codicon-comment-discussion' />
            <div className='ingot-slack-text'>
                <div className='ingot-slack-title'>{SLACK_TEXT.title} <span className='ingot-slack-tag'>Built-in</span></div>
                <div className='ingot-slack-status' id='ingot-slack-status'><span className='ingot-slack-dot' />{view.summary}</div>
            </div>
            <div className='ingot-slack-actions'>
                {showConnect && <button type='button' id='ingot-slack-connect' className='ingot-slack-primary' onClick={() => setEditing(true)}>
                    {view.state === 'disconnected' ? SLACK_TEXT.connect : SLACK_TEXT.reconnect}
                </button>}
                {view.state === 'off' && <button type='button' id='ingot-slack-turn-on' className='ingot-slack-primary' disabled={busy} onClick={() => run(() => service.turnOn())}>{SLACK_TEXT.turnOn}</button>}
                {service.canDisconnect && <button type='button' id='ingot-slack-disconnect' className='ingot-slack-secondary' disabled={busy}
                    onClick={() => run(() => service.disconnect())}>{SLACK_TEXT.disconnect}</button>}
            </div>
        </div>
        <p className='ingot-slack-desc'>{view.state === 'connected' ? SLACK_TEXT.capabilities : SLACK_TEXT.description}</p>
        {editing && <form className='ingot-slack-form' id='ingot-slack-form' onSubmit={submit}>
            <label className='ingot-slack-field'>
                <span>{SLACK_TEXT.tokenLabel}</span>
                <input id='ingot-slack-token' type='password' autoComplete='off' spellCheck={false} autoFocus placeholder={SLACK_TEXT.tokenPlaceholder} value={token}
                    onChange={e => { setToken(e.currentTarget.value); setError(undefined); }} />
            </label>
            <p className='ingot-slack-hint'>{SLACK_TEXT.tokenHint} <a href='#' id='ingot-slack-apps' onClick={e => { e.preventDefault(); onOpenApps(); }}>{SLACK_TEXT.createApp}</a></p>
            {error && <div className='ingot-slack-error' id='ingot-slack-error'>{error}</div>}
            <div className='ingot-slack-form-actions'>
                <button type='button' className='ingot-slack-secondary' onClick={() => { setEditing(false); setToken(''); setError(undefined); }}>{SLACK_TEXT.cancel}</button>
                <button type='submit' id='ingot-slack-save' className='ingot-slack-primary' disabled={busy}>{busy ? SLACK_TEXT.saving : SLACK_TEXT.save}</button>
            </div>
        </form>}
    </section>;
};
