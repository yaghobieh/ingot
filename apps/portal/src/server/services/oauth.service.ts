import 'server-only';
import type { AuthProvidersInfo, OAuthProvider } from '@/types/domain.types';
import { getConfig } from '@server/config/config';
import { query } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';
import { emailDeliveryConfigured } from '@server/services/mail.service';
import { GITHUB_EMAILS_URL, OAUTH_ENDPOINTS, OAUTH_PROVIDERS } from '@server/services/oauth.consts';
import { upsertVerifiedUser } from '@server/services/user.service';
import type { PublicUser } from '@/types/domain.types';

interface OAuthProfile {
    id: string;
    email: string;
    name: string;
    avatarUrl: string;
}

export function isOAuthProvider(value: string): value is OAuthProvider {
    return (OAUTH_PROVIDERS as string[]).includes(value);
}

export function providerConfigured(provider: OAuthProvider): boolean {
    const client = getConfig().oauth[provider];
    return Boolean(client.clientId && client.clientSecret);
}

export function authProviders(): AuthProvidersInfo {
    return { email: emailDeliveryConfigured(), github: providerConfigured('github'), google: providerConfigured('google') };
}

export function redirectUri(provider: OAuthProvider): string {
    return `${getConfig().appUrl}/api/auth/oauth/${provider}/callback`;
}

export function authorizeUrl(provider: OAuthProvider, state: string): string {
    const endpoints = OAUTH_ENDPOINTS[provider];
    const params = new URLSearchParams({
        client_id: getConfig().oauth[provider].clientId,
        redirect_uri: redirectUri(provider),
        scope: endpoints.scope,
        state,
        response_type: 'code'
    });
    if (provider === 'google') { params.set('prompt', 'select_account'); }
    return `${endpoints.authorize}?${params.toString()}`;
}

async function exchangeCode(provider: OAuthProvider, code: string): Promise<string> {
    const client = getConfig().oauth[provider];
    const response = await fetch(OAUTH_ENDPOINTS[provider].token, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            code,
            redirect_uri: redirectUri(provider),
            grant_type: 'authorization_code'
        })
    });
    const body = await response.json() as { access_token?: string };
    if (!response.ok || !body.access_token) { fail(HTTP_STATUS.badRequest, 'oauth_exchange_failed'); }
    return body.access_token;
}

async function fetchProfile(provider: OAuthProvider, accessToken: string): Promise<OAuthProfile> {
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'ingot-portal' };
    const profile = await (await fetch(OAUTH_ENDPOINTS[provider].profile, { headers })).json() as Record<string, unknown>;
    if (provider === 'google') {
        if (!profile.email || profile.email_verified !== true) { fail(HTTP_STATUS.badRequest, 'oauth_email_unverified'); }
        return { id: String(profile.sub), email: String(profile.email), name: String(profile.name ?? ''), avatarUrl: String(profile.picture ?? '') };
    }
    const emails = await (await fetch(GITHUB_EMAILS_URL, { headers })).json() as { email: string; primary: boolean; verified: boolean }[];
    const primary = Array.isArray(emails) ? emails.find(entry => entry.primary && entry.verified) : undefined;
    if (!primary) { fail(HTTP_STATUS.badRequest, 'oauth_email_unverified'); }
    return { id: String(profile.id), email: primary.email, name: String(profile.name ?? profile.login ?? ''), avatarUrl: String(profile.avatar_url ?? '') };
}

export async function completeOAuth(provider: OAuthProvider, code: string): Promise<PublicUser> {
    const profile = await fetchProfile(provider, await exchangeCode(provider, code));
    const user = await upsertVerifiedUser(profile.email, profile.name, profile.avatarUrl);
    await query(
        'INSERT INTO oauth_accounts (provider, provider_user_id, user_id) VALUES ($1, $2, $3) ON CONFLICT (provider, provider_user_id) DO NOTHING',
        [provider, profile.id, user.id]
    );
    return user;
}
