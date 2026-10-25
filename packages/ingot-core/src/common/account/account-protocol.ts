import type { RpcServer } from '@theia/core/lib/common/messaging';
import type { RemoteConfigSnapshot } from '../config/remote-config.types';

export const ACCOUNT_SERVICE_PATH = '/services/ingot/account';
export const AccountBackend = Symbol('IngotAccountBackend');

/** Where the account API (ingot-server) and the website (portal) live. Non-secret; from preferences. */
export interface AccountUrls {
    readonly serverUrl: string;
    readonly portalUrl: string;
}

export interface AccountUser {
    readonly name: string;
    readonly email: string;
    readonly plan: string;
    readonly avatarUrl?: string;
    /** From /api/me (IDEA-124): `admin` shows "Open admin console". */
    readonly role?: string;
}

/** Tokens this billing period (allowance includes grants). */
export interface AccountTokens {
    readonly used: number;
    readonly remaining: number;
    readonly allowance: number;
}

/** What the IDE shows about the account. Never carries tokens or keys. */
export interface AccountSnapshot {
    readonly signedIn: boolean;
    readonly user?: AccountUser;
    readonly tokens?: AccountTokens;
    /** A browser sign-in is waiting for the user. */
    readonly pending?: boolean;
    readonly error?: string;
    /** 403 account_blocked (IDEA-124): an admin blocked the account; the session is gone and background calls stop. */
    readonly blocked?: boolean;
    /** Epoch ms of the last status refresh. */
    readonly updatedAt: number;
}

/** A model served by the Ingot gateway (GET /v1/models). */
export interface GatewayModelInfo {
    readonly id: string;
    readonly label: string;
    readonly contextWindow: number;
    readonly available: boolean;
    /** Admin-controlled sort order (IDEA-124); the list is already sorted by it. */
    readonly order: number;
    /** The plan's default model. */
    readonly isDefault: boolean;
    /** Why `available` is false, when the server says. */
    readonly reason?: string;
}

export interface SignInOptions {
    /** Local development: sign in through the portal's dev login as this @ingot.dev account (loopback servers only). */
    readonly devEmail?: string;
}

export interface AccountClient {
    onDidChange(snapshot: AccountSnapshot): void;
}

/** Backend account session (IDEA-101): sign-in, keychain-held tokens, status and the gateway models. */
export interface AccountBackend extends RpcServer<AccountClient> {
    /** Empty strings keep the backend default (INGOT_SERVER_URL / INGOT_PORTAL_URL, else local dev). */
    configure(urls: AccountUrls): Promise<AccountSnapshot>;
    urls(): Promise<AccountUrls>;
    snapshot(): Promise<AccountSnapshot>;
    /** Starts a browser sign-in and returns the URL to open; the session arrives on the loopback callback. */
    signIn(options?: SignInOptions): Promise<string>;
    cancelSignIn(): Promise<void>;
    /** ingot://auth?code=… ("Open in Ingot") or ingot://auth/callback. */
    handleDeepLink(url: string): Promise<boolean>;
    signOut(): Promise<void>;
    refresh(): Promise<AccountSnapshot>;
    models(): Promise<GatewayModelInfo[]>;
    /** GET /v1/config (IDEA-125), signed in or not; falls back to the disk cache offline. No calls while blocked. */
    remoteConfig(): Promise<RemoteConfigSnapshot>;
}
