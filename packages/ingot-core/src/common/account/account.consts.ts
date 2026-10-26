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

/** IDEA-140: runtime overrides read by the backend (an explicit setting in ~/.ingot wins over these). */
export const SERVER_URL_ENV = 'INGOT_SERVER_URL';
export const PORTAL_URL_ENV = 'INGOT_PORTAL_URL';
/** Key in the packaged app's package.json where the release build bakes the public URLs. */
export const BAKED_ENDPOINTS_KEY = 'ingotEndpoints';

/** IDEA-143: the provider photo (Google / GitHub) is cached on this device so it shows offline and loads instantly. */
export const AVATAR_CACHE_KEY = 'ingot.account.avatar';
/** Larger photos are not cached (they still show from the URL). */
export const AVATAR_CACHE_MAX_BYTES = 256 * 1024;
/** A cached photo is re-fetched after this long, and on every sign-in or sync that reports a new URL. */
export const AVATAR_CACHE_TTL_MS = 24 * 60 * 60_000;
export const AVATAR_URL_MAX_LENGTH = 2048;
