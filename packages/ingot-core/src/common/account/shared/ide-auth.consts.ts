// Copied from ingot-server packages/shared/src/ide-auth.consts.ts (canonical copy). Keep in sync; do not edit here.
/** IDE <-> server sign-in contract. Shared by ingot-server, the portal and the IDE. */
export const IDE_AUTH_PATHS = {
    /** Portal page where the IDE-initiated (PKCE) sign-in is approved. */
    authorizePage: '/ide/authorize',
    /** Portal page that creates an "Open in Ingot" hand-off for the signed-in user. */
    openPage: '/ide/open',
    authorize: '/api/ide/authorize',
    handoff: '/api/ide/handoff',
    token: '/api/ide/token',
    revoke: '/api/ide/revoke',
    sessions: '/api/ide/sessions',
    status: '/api/ide/status',
    activity: '/api/ide/activity',
    gatewayKey: '/api/gateway/key',
    balance: '/api/balance',
    usage: '/api/usage',
    me: '/api/me'
} as const;

export const IDE_ACCESS_TOKEN_PREFIX = 'ingot_at_';
export const IDE_REFRESH_TOKEN_PREFIX = 'ingot_rt_';
export const IDE_ACCESS_TOKEN_TTL_SECONDS = 3600;
export const IDE_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
export const IDE_AUTH_CODE_TTL_SECONDS = 120;
/** "Open in Ingot" one-time code lifetime. Short on purpose: it travels through a custom URL scheme. */
export const IDE_HANDOFF_CODE_TTL_SECONDS = 60;

export const IDE_GRANT_TYPES = {
    authorizationCode: 'authorization_code',
    refreshToken: 'refresh_token',
    handoff: 'urn:ingot:grant-type:handoff'
} as const;
export const PKCE_METHOD = 'S256';
export const PKCE_VERIFIER_MIN = 43;
export const PKCE_VERIFIER_MAX = 128;

/** Deep link that carries the PKCE auth code back to the IDE (IDE-initiated sign-in). */
export const IDE_DEEP_LINK_REDIRECT = 'ingot://auth/callback';
/** Deep link prefix for the site-initiated "Open in Ingot" hand-off: ingot://auth?code=... */
export const IDE_HANDOFF_DEEP_LINK = 'ingot://auth';
export const IDE_DEEP_LINK_SCHEME = 'ingot:';
export const IDE_LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'] as const;

/** Statuses the IDE reports for an agent / background process. */
export const IDE_ACTIVITY_STATUSES = ['idle', 'running', 'waiting', 'error'] as const;
/** An IDE that has not reported for this long is shown as offline. */
export const IDE_ACTIVITY_STALE_SECONDS = 600;
/** Refresh the access token when it has less than this left. */
export const IDE_REFRESH_SKEW_SECONDS = 120;
