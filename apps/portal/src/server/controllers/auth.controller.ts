import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OAUTH_NEXT_COOKIE, OAUTH_STATE_COOKIE, ROUTES, SESSION_COOKIE } from '@/constants/app.consts';
import type { OtpPurpose } from '@/types/domain.types';
import { getConfig } from '@server/config/config';
import { safeNext, secureCookies, startBrowserSession } from '@server/http/cookies';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail, handle, json, readJson, requireString } from '@server/http/http';
import type { RouteContext } from '@server/http/http.types';
import { readOutbox } from '@server/services/mail.service';
import { OAUTH_STATE_BYTES, OAUTH_STATE_MAX_AGE_SECONDS } from '@server/services/oauth.consts';
import { authProviders, authorizeUrl, completeOAuth, isOAuthProvider, providerConfigured } from '@server/services/oauth.service';
import { requestOtp, verifyOtp } from '@server/services/otp.service';
import { destroySession } from '@server/services/session.service';
import { normalizeEmail, upsertVerifiedUser } from '@server/services/user.service';
import { randomToken, safeEqual } from '@server/utils/crypto.utils';

const MAX_NAME = 120;
const OTP_CODE_MAX = 12;

export const providers = handle(async () => json(authProviders()));

export const requestCode = handle(async request => {
    const body = await readJson<{ email?: string; purpose?: OtpPurpose; name?: string }>(request);
    const purpose: OtpPurpose = body.purpose === 'sign-up' ? 'sign-up' : 'sign-in';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    await requestOtp(requireString(body.email, 'invalid_email'), purpose, name);
    return json({ sent: true });
});

export const verifyCode = handle(async request => {
    const body = await readJson<{ email?: string; code?: string; next?: string }>(request);
    const email = requireString(body.email, 'invalid_email');
    const { name } = await verifyOtp(email, requireString(body.code, 'invalid_code', OTP_CODE_MAX));
    const user = await upsertVerifiedUser(email, name);
    await startBrowserSession(user.id);
    return json({ user, next: safeNext(body.next, ROUTES.dashboard) });
});

export const signOut = handle(async () => {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) { await destroySession(token); }
    jar.delete(SESSION_COOKIE);
    return json({ signedOut: true });
});

export const oauthStart = handle(async (request, context: RouteContext) => {
    const { provider } = await (context as RouteContext<{ provider: string }>).params;
    if (!isOAuthProvider(provider) || !providerConfigured(provider)) { fail(HTTP_STATUS.notFound, 'provider_not_configured'); }
    const state = randomToken(OAUTH_STATE_BYTES);
    const jar = await cookies();
    const options = { httpOnly: true, sameSite: 'lax' as const, secure: secureCookies(), path: '/', maxAge: OAUTH_STATE_MAX_AGE_SECONDS };
    jar.set(OAUTH_STATE_COOKIE, state, options);
    jar.set(OAUTH_NEXT_COOKIE, safeNext(new URL(request.url).searchParams.get('next'), ROUTES.dashboard), options);
    return NextResponse.redirect(authorizeUrl(provider, state));
});

export const oauthCallback = handle(async (request, context: RouteContext) => {
    const { provider } = await (context as RouteContext<{ provider: string }>).params;
    const url = new URL(request.url);
    const jar = await cookies();
    const expected = jar.get(OAUTH_STATE_COOKIE)?.value ?? '';
    const next = safeNext(jar.get(OAUTH_NEXT_COOKIE)?.value, ROUTES.dashboard);
    jar.delete(OAUTH_STATE_COOKIE);
    jar.delete(OAUTH_NEXT_COOKIE);
    const appUrl = getConfig().appUrl;
    const code = url.searchParams.get('code');
    if (!isOAuthProvider(provider) || !code || !expected || !safeEqual(expected, url.searchParams.get('state') ?? '')) {
        return NextResponse.redirect(`${appUrl}${ROUTES.signIn}?error=oauth_failed`);
    }
    try {
        const user = await completeOAuth(provider, code);
        await startBrowserSession(user.id);
        return NextResponse.redirect(`${appUrl}${next}`);
    } catch {
        return NextResponse.redirect(`${appUrl}${ROUTES.signIn}?error=oauth_failed`);
    }
});

/** Dev/test only (features.devOutbox + outbox provider): read the emails the outbox "sent" to an address. */
export const devOutbox = handle(async request => {
    const { features, email: mail } = getConfig();
    if (!features.devOutbox || mail.provider !== 'outbox') {
        fail(HTTP_STATUS.notFound, 'not_found');
    }
    const email = normalizeEmail(new URL(request.url).searchParams.get('email') ?? '');
    return json({ messages: await readOutbox(email) });
});
