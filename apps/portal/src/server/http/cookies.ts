import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/constants/app.consts';
import { getConfig } from '@server/config/config';
import { createSession } from '@server/services/session.service';

export function secureCookies(): boolean {
    return getConfig().appUrl.startsWith('https://');
}

export async function startBrowserSession(userId: string): Promise<void> {
    const session = await createSession(userId);
    (await cookies()).set(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies(),
        path: '/',
        expires: session.expiresAt
    });
}

/** Only same-site relative paths are allowed as post-login redirects. */
export function safeNext(next: unknown, fallback: string): string {
    return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
