import 'server-only';
import type { OtpPurpose } from '@/types/domain.types';
import { query, queryOne } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';
import { MAIL_TEMPLATES } from '@server/services/mail.consts';
import { sendMail } from '@server/services/mail.service';
import { normalizeEmail } from '@server/services/user.service';
import { MS_PER_MINUTE, OTP_MAX_ATTEMPTS, OTP_MAX_PER_WINDOW, OTP_TTL_MINUTES, OTP_WINDOW_MINUTES } from '@server/utils/crypto.consts';
import { generateOtp, safeEqual, sha256 } from '@server/utils/crypto.utils';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
    return EMAIL_PATTERN.test(email);
}

export async function requestOtp(rawEmail: string, purpose: OtpPurpose, name: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) { fail(HTTP_STATUS.badRequest, 'invalid_email'); }
    const recent = await queryOne<{ count: string }>(
        'SELECT count(*) FROM otp_codes WHERE email = $1 AND created_at > now() - make_interval(mins => $2)',
        [email, OTP_WINDOW_MINUTES]
    );
    if (Number(recent?.count ?? 0) >= OTP_MAX_PER_WINDOW) { fail(HTTP_STATUS.tooMany, 'too_many_codes'); }
    const code = generateOtp();
    await query(
        'INSERT INTO otp_codes (email, code_hash, purpose, name, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [email, sha256(`${email}:${code}`), purpose, name, new Date(Date.now() + OTP_TTL_MINUTES * MS_PER_MINUTE)]
    );
    await sendMail({ to: email, ...MAIL_TEMPLATES.otp(code, OTP_TTL_MINUTES) });
}

/** Verifies the latest live code for the email. Returns the name captured at sign-up. */
export async function verifyOtp(rawEmail: string, code: string): Promise<{ name: string }> {
    const email = normalizeEmail(rawEmail);
    const row = await queryOne<{ id: string; code_hash: string; attempts: number; name: string }>(
        'SELECT id, code_hash, attempts, name FROM otp_codes WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1',
        [email]
    );
    if (!row) { fail(HTTP_STATUS.badRequest, 'code_expired'); }
    if (row.attempts >= OTP_MAX_ATTEMPTS) { fail(HTTP_STATUS.tooMany, 'too_many_attempts'); }
    if (!safeEqual(row.code_hash, sha256(`${email}:${code.trim()}`))) {
        await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        fail(HTTP_STATUS.badRequest, 'invalid_code');
    }
    await query('UPDATE otp_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL', [email]);
    return { name: row.name };
}
