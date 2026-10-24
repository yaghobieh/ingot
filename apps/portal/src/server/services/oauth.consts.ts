import type { OAuthProvider } from '@/types/domain.types';

export interface OAuthEndpoints {
    authorize: string;
    token: string;
    profile: string;
    scope: string;
}

export const OAUTH_PROVIDERS: OAuthProvider[] = ['github', 'google'];

export const OAUTH_ENDPOINTS: Record<OAuthProvider, OAuthEndpoints> = {
    github: {
        authorize: 'https://github.com/login/oauth/authorize',
        token: 'https://github.com/login/oauth/access_token',
        profile: 'https://api.github.com/user',
        scope: 'read:user user:email'
    },
    google: {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        profile: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile'
    }
};

export const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';
export const OAUTH_STATE_BYTES = 24;
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;
