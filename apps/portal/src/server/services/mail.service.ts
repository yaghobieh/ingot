import 'server-only';
import { getConfig } from '@server/config/config';
import { query } from '@server/db/db';
import { RESEND_ENDPOINT } from '@server/services/mail.consts';

export interface MailMessage {
    to: string;
    subject: string;
    text: string;
}

/**
 * Sends a transactional email. Provider `resend` sends through Resend; provider `outbox`
 * (local/dev/test) stores the message in the email_outbox table instead of sending.
 */
export async function sendMail(message: MailMessage): Promise<void> {
    const { email } = getConfig();
    if (email.provider === 'resend' && email.resendApiKey) {
        const response = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${email.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: email.from, to: [message.to], subject: message.subject, text: message.text })
        });
        if (!response.ok) { throw new Error(`email send failed with status ${response.status}`); }
        return;
    }
    await query('INSERT INTO email_outbox (to_email, subject, body) VALUES ($1, $2, $3)', [message.to, message.subject, message.text]);
}

export function emailDeliveryConfigured(): boolean {
    const { email } = getConfig();
    return email.provider === 'outbox' || Boolean(email.resendApiKey);
}

/** Dev/test only: latest outbox messages for an address. Guarded by features.devOutbox. */
export async function readOutbox(to: string): Promise<MailMessage[]> {
    const rows = await query<{ to_email: string; subject: string; body: string }>(
        'SELECT to_email, subject, body FROM email_outbox WHERE to_email = $1 ORDER BY id DESC LIMIT 10',
        [to]
    );
    return rows.map(row => ({ to: row.to_email, subject: row.subject, text: row.body }));
}
