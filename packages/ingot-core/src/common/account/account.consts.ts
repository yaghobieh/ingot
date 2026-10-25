export const DEFAULT_SERVER_URL = 'http://127.0.0.1:3300';
export const DEFAULT_PORTAL_URL = 'http://localhost:3200';
export const DEV_ACCOUNT_EMAIL = 'test@ingot.dev';
export const DEV_LOGIN_PATH = '/api/dev/login';
export const GATEWAY_PATH = '/v1';
export const INGOT_MODEL_PREFIX = 'ingot:';
/** Keychain entry holding the IDE session (JSON with the access + refresh token). */
export const ACCOUNT_KEYCHAIN_KEY = 'ingot-account-session';
/** After a gateway call, refresh usage this soon (debounced across quick calls). */
export const USAGE_REFRESH_DELAY_MS = 400;
/** Background status refresh while signed in. */
export const STATUS_POLL_MS = 60_000;
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export const ACCOUNT_PREFERENCES = {
    serverUrl: 'ingot.account.serverUrl',
    portalUrl: 'ingot.account.portalUrl'
} as const;

/** Backend route the desktop main process forwards ingot://auth links to (loopback only). */
export const DEEP_LINK_BACKEND_PATH = '/ingot/deep-link';
