import { isLoopbackUrl } from '../../common/account/gateway.utils';

const AUTHORIZE_API = '/api/ide/authorize';

/**
 * Local dev only: finishes "Sign in as test@ingot.dev" without a browser. Opens the portal's dev-login URL (session
 * cookie), approves the IDE authorize request it redirects to, then calls the IDE's own loopback callback with the
 * one-time code, exactly as the browser would. Nothing secret is logged or returned.
 */
export const completeDevSignIn = async (devLoginUrl: string, fetchImpl: typeof fetch = fetch): Promise<void> => {
    const login = await fetchImpl(devLoginUrl, { redirect: 'manual' });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const location = login.headers.get('location');
    if (!cookie || !location) {
        throw new Error('Dev login did not start a portal session.');
    }
    const authorize = new URL(location, devLoginUrl).searchParams;
    const origin = new URL(devLoginUrl).origin;
    const approved = await fetchImpl(`${origin}${AUTHORIZE_API}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin },
        body: JSON.stringify({
            redirectUri: authorize.get('redirect_uri'), state: authorize.get('state'), codeChallenge: authorize.get('code_challenge'),
            codeChallengeMethod: authorize.get('code_challenge_method'), clientName: authorize.get('client_name'), approve: true
        })
    });
    const { redirectTo } = await approved.json().catch(() => ({})) as { redirectTo?: string };
    if (!approved.ok || !redirectTo) {
        throw new Error(`The portal did not approve the dev sign-in (${approved.status}).`);
    }
    if (!isLoopbackUrl(redirectTo)) {
        throw new Error('Dev sign-in only hands codes to a local callback.');
    }
    await fetchImpl(redirectTo, { redirect: 'manual' });
};
