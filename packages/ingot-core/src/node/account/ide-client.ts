// Copied from ingot-server packages/shared/src/ide-client.ts (canonical copy). Keep in sync; do not edit here.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    IDE_AUTH_PATHS, IDE_DEEP_LINK_REDIRECT, IDE_DEEP_LINK_SCHEME, IDE_GRANT_TYPES, IDE_REFRESH_SKEW_SECONDS, PKCE_METHOD
} from '../../common/account/shared/ide-auth.consts';
import type {
    GatewayKeyResponse, IdeActivity, IdeActivityReport, IdeDeepLink, IdeStatusResponse, IdeTokenResponse
} from '../../common/account/shared/ide-auth.types';
import type { BalanceResponse } from '../../common/account/shared/usage.types';

const VERIFIER_BYTES = 48;
const STATE_BYTES = 16;
const CALLBACK_PATH = '/callback';
const MS_PER_SECOND = 1000;
const CALLBACK_HTML = '<!doctype html><meta charset="utf-8"><title>Ingot</title><p>Signed in. You can close this tab and go back to Ingot.</p>';

export interface IdeSignInHandle {
    authorizeUrl: string;
    redirectUri: string;
    /** Resolves with the auth code once the browser hits the loopback callback. */
    code: Promise<string>;
    verifier: string;
    close: () => void;
}

/** Tokens as the IDE keeps them (store them in the OS keychain, never in settings files). */
export interface IdeStoredSession {
    accessToken: string;
    refreshToken: string;
    /** Epoch ms. */
    accessExpiresAt: number;
    refreshExpiresAt: number;
}

/** Where the IDE persists the session (Keychain-backed in the app, in-memory in tests). */
export interface IdeSessionStore {
    load(): Promise<IdeStoredSession | undefined>;
    save(session: IdeStoredSession): Promise<void>;
    clear(): Promise<void>;
}

export interface IngotIdeClientOptions {
    /** Website (portal) origin: sign-in pages live here. */
    portalUrl: string;
    /** API origin (ingot-server). Defaults to portalUrl, which proxies /api/* to the server. */
    serverUrl?: string;
    clientName?: string;
    fetch?: typeof fetch;
}

export class IdeAuthError extends Error {
    constructor(public readonly code: string, public readonly status = 0) {
        super(code);
    }
}

const base64url = (buffer: Buffer) => buffer.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
    const verifier = base64url(randomBytes(VERIFIER_BYTES));
    return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

/**
 * Parses a URL the OS handed to the IDE.
 * - `ingot://auth?code=...`             -> "Open in Ingot" hand-off from the website
 * - `ingot://auth/callback?code&state`  -> IDE-initiated PKCE sign-in via deep link
 */
export function parseDeepLink(raw: string): IdeDeepLink {
    let url: URL;
    try { url = new URL(raw); } catch { return { kind: 'unknown' }; }
    if (url.protocol !== IDE_DEEP_LINK_SCHEME || url.hostname !== 'auth') { return { kind: 'unknown' }; }
    const error = url.searchParams.get('error');
    const state = url.searchParams.get('state') ?? undefined;
    if (error) { return { kind: 'error', error, state }; }
    const code = url.searchParams.get('code') ?? '';
    if (!code) { return { kind: 'unknown' }; }
    if (url.pathname === CALLBACK_PATH) { return state ? { kind: 'callback', code, state } : { kind: 'unknown' }; }
    return url.pathname === '' || url.pathname === '/' ? { kind: 'handoff', code } : { kind: 'unknown' };
}

export function toStoredSession(tokens: IdeTokenResponse, now = Date.now()): IdeStoredSession {
    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessExpiresAt: now + tokens.expires_in * MS_PER_SECOND,
        refreshExpiresAt: now + tokens.refresh_expires_in * MS_PER_SECOND
    };
}

/** Low-level client for the Ingot account API (what the IDE calls). Stateless: pass tokens in. */
export class IngotIdeClient {
    private readonly portalUrl: string;
    private readonly serverUrl: string;
    private readonly clientName: string;
    private readonly fetchImpl: typeof fetch;

    constructor(options: IngotIdeClientOptions | string, clientName = 'Ingot IDE') {
        const opts = typeof options === 'string' ? { portalUrl: options, clientName } : options;
        this.portalUrl = opts.portalUrl.replace(/\/$/, '');
        this.serverUrl = (opts.serverUrl ?? opts.portalUrl).replace(/\/$/, '');
        this.clientName = opts.clientName ?? clientName;
        this.fetchImpl = opts.fetch ?? fetch;
    }

    /** Website page that signs the user in (if needed) and offers "Open in Ingot". */
    openInBrowserUrl(): string {
        return `${this.portalUrl}${IDE_AUTH_PATHS.openPage}`;
    }

    /** IDE-initiated sign-in: loopback server on 127.0.0.1 + PKCE. Use `deepLink: true` to receive the code on ingot://auth/callback instead. */
    async beginSignIn(options: { deepLink?: boolean } = {}): Promise<IdeSignInHandle> {
        const { verifier, challenge } = pkcePair();
        const state = base64url(randomBytes(STATE_BYTES));
        let resolveCode: (code: string) => void = () => undefined;
        let rejectCode: (error: Error) => void = () => undefined;
        const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
        // Callers may await `code` after the browser already answered; keep an early rejection from being "unhandled".
        code.catch(() => undefined);
        let server: Server | undefined;
        let redirectUri = IDE_DEEP_LINK_REDIRECT;
        if (!options.deepLink) {
            server = createServer((request, response) => {
                const url = new URL(request.url ?? '/', 'http://127.0.0.1');
                if (url.pathname !== CALLBACK_PATH) { response.writeHead(404).end(); return; }
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CALLBACK_HTML);
                if (url.searchParams.get('state') !== state) { rejectCode(new Error('state_mismatch')); return; }
                const error = url.searchParams.get('error');
                if (error) { rejectCode(new Error(error)); return; }
                resolveCode(url.searchParams.get('code') ?? '');
            });
            const listening = server;
            await new Promise<void>(resolve => listening.listen(0, '127.0.0.1', resolve));
            const { port } = listening.address() as AddressInfo;
            redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
        }
        const params = new URLSearchParams({
            client_name: this.clientName, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: PKCE_METHOD
        });
        return {
            authorizeUrl: `${this.portalUrl}${IDE_AUTH_PATHS.authorizePage}?${params}`,
            redirectUri, code, verifier, close: () => server?.close()
        };
    }

    async exchange(code: string, verifier: string, redirectUri: string): Promise<IdeTokenResponse> {
        return this.tokenRequest({ grant_type: IDE_GRANT_TYPES.authorizationCode, code, code_verifier: verifier, redirect_uri: redirectUri });
    }

    /** "Open in Ingot": trade the one-time code from ingot://auth?code=... for a session. */
    async exchangeHandoff(code: string): Promise<IdeTokenResponse> {
        return this.tokenRequest({ grant_type: IDE_GRANT_TYPES.handoff, code, client_name: this.clientName });
    }

    async refresh(refreshToken: string): Promise<IdeTokenResponse> {
        return this.tokenRequest({ grant_type: IDE_GRANT_TYPES.refreshToken, refresh_token: refreshToken });
    }

    async revoke(token: string): Promise<void> {
        await this.fetchImpl(`${this.serverUrl}${IDE_AUTH_PATHS.revoke}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    }

    async gatewayKey(accessToken: string): Promise<GatewayKeyResponse> {
        return this.authed<GatewayKeyResponse>(accessToken, IDE_AUTH_PATHS.gatewayKey);
    }

    /** Signed-in account, tokens used / remaining and agent activity across this user's IDEs. */
    async status(accessToken: string): Promise<IdeStatusResponse> {
        return this.authed<IdeStatusResponse>(accessToken, IDE_AUTH_PATHS.status);
    }

    async balance(accessToken: string): Promise<BalanceResponse> {
        return this.authed<BalanceResponse>(accessToken, IDE_AUTH_PATHS.balance);
    }

    /** Heartbeat for the current agent / process (call on change and every few minutes while running). */
    async reportActivity(accessToken: string, report: IdeActivityReport): Promise<IdeActivity> {
        return this.authed<IdeActivity>(accessToken, IDE_AUTH_PATHS.activity, { method: 'POST', body: report });
    }

    private async authed<T>(accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
        const response = await this.fetchImpl(`${this.serverUrl}${path}`, {
            method: init.method ?? 'GET',
            headers: { Authorization: `Bearer ${accessToken}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: init.body === undefined ? undefined : JSON.stringify(init.body)
        });
        const data = await response.json().catch(() => ({})) as T & { error?: string };
        if (!response.ok) { throw new IdeAuthError(data.error ?? `http_${response.status}`, response.status); }
        return data;
    }

    private async tokenRequest(body: Record<string, string>): Promise<IdeTokenResponse> {
        const response = await this.fetchImpl(`${this.serverUrl}${IDE_AUTH_PATHS.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json().catch(() => ({})) as IdeTokenResponse & { error?: string };
        if (!response.ok) { throw new IdeAuthError(data.error ?? `token_${response.status}`, response.status); }
        return data;
    }
}

export type IdeAccountState =
    | { signedIn: false }
    | { signedIn: true; status: IdeStatusResponse };

/**
 * Stateful account session the IDE holds: handles ingot:// links, keeps the access token fresh
 * (1h, rotated refresh up to 30 days), and exposes the account + tokens left + activity for the UI.
 */
export class IngotAccountSession {
    private session: IdeStoredSession | undefined;
    private refreshing: Promise<IdeStoredSession | undefined> | undefined;
    private readonly listeners = new Set<(state: IdeAccountState) => void>();

    constructor(private readonly client: IngotIdeClient, private readonly store: IdeSessionStore, private readonly now: () => number = Date.now) {}

    onChange(listener: (state: IdeAccountState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async restore(): Promise<IdeAccountState> {
        this.session = await this.store.load();
        return this.refreshStatus();
    }

    /** Call from the IDE's open-url handler. Returns true when the link signed the user in. */
    async handleDeepLink(raw: string, pending?: { state: string; verifier: string }): Promise<boolean> {
        const link = parseDeepLink(raw);
        let tokens: IdeTokenResponse | undefined;
        if (link.kind === 'handoff') { tokens = await this.client.exchangeHandoff(link.code); }
        if (link.kind === 'callback' && pending && link.state === pending.state) {
            tokens = await this.client.exchange(link.code, pending.verifier, IDE_DEEP_LINK_REDIRECT);
        }
        if (!tokens) { return false; }
        await this.adopt(tokens);
        return true;
    }

    async adopt(tokens: IdeTokenResponse): Promise<IdeAccountState> {
        this.session = toStoredSession(tokens, this.now());
        await this.store.save(this.session);
        return this.refreshStatus();
    }

    /** A valid access token, refreshing it first when it is about to expire. Undefined = signed out. */
    async accessToken(): Promise<string | undefined> {
        const current = this.session;
        if (!current) { return undefined; }
        if (current.accessExpiresAt - this.now() > IDE_REFRESH_SKEW_SECONDS * MS_PER_SECOND) { return current.accessToken; }
        if (current.refreshExpiresAt <= this.now()) { await this.signOut(false); return undefined; }
        this.refreshing ??= this.client.refresh(current.refreshToken)
            .then(async tokens => { this.session = toStoredSession(tokens, this.now()); await this.store.save(this.session); return this.session; })
            .catch(async error => {
                if (error instanceof IdeAuthError && error.code === 'invalid_grant') { await this.signOut(false); return undefined; }
                throw error;
            })
            .finally(() => { this.refreshing = undefined; });
        return (await this.refreshing)?.accessToken;
    }

    async refreshStatus(): Promise<IdeAccountState> {
        const token = await this.accessToken();
        const state: IdeAccountState = token ? { signedIn: true, status: await this.client.status(token) } : { signedIn: false };
        this.listeners.forEach(listener => listener(state));
        return state;
    }

    async reportActivity(report: IdeActivityReport): Promise<IdeActivity | undefined> {
        const token = await this.accessToken();
        return token ? this.client.reportActivity(token, report) : undefined;
    }

    /** Base URL + bearer for OpenAI-compatible model calls (native mode: the current access token, refreshed). */
    async modelCredentials(): Promise<{ baseUrl: string; apiKey: string; models: string[] } | undefined> {
        const token = await this.accessToken();
        if (!token) { return undefined; }
        const gateway = await this.client.gatewayKey(token);
        return { baseUrl: gateway.baseUrl, apiKey: gateway.mode === 'litellm' && gateway.key ? gateway.key : token, models: gateway.models };
    }

    async signOut(revoke = true): Promise<void> {
        const current = this.session;
        this.session = undefined;
        await this.store.clear();
        if (revoke && current) { await this.client.revoke(current.refreshToken).catch(() => undefined); }
        this.listeners.forEach(listener => listener({ signedIn: false }));
    }
}
