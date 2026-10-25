import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { RemoteConfigSnapshot } from '../../common/config/remote-config.types';
import type { SyncResponse } from '../../common/sync/sync.types';
import { SYNC_PATH } from '../../common/sync/sync.consts';
import { CONFIG_CACHE_FILE, CONFIG_PATH } from '../../common/config/remote-config.consts';
import { defaultRemoteConfig, parseRemoteConfig } from '../../common/config/remote-config.utils';
import { DEFAULT_KEYCHAIN_SERVICE } from '../../common/models/models.consts';
import type { AccountBackend, AccountClient, AccountSnapshot, AccountUrls, GatewayModelInfo, SignInOptions } from '../../common/account/account-protocol';
import {
    ACCOUNT_KEYCHAIN_KEY, DEFAULT_PORTAL_URL, DEFAULT_SERVER_URL, DEV_ACCOUNT_EMAIL, GATEWAY_PATH, SIGN_IN_TIMEOUT_MS, STATUS_POLL_MS, USAGE_REFRESH_DELAY_MS
} from '../../common/account/account.consts';
import { devLoginUrl, ideHeaders, isLoopbackUrl, parseGatewayModels, roleOf, snapshotOf } from '../../common/account/gateway.utils';
import { PRODUCT } from '../../common/product.consts';
import { IdeAuthError, IngotAccountSession, IngotIdeClient, type IdeSessionStore, type IdeSignInHandle, type IdeStoredSession } from './ide-client';

const CLIENT_NAME = 'Ingot IDE';

/**
 * The IDE's Ingot account (IDEA-101). Tokens live only here and in the OS keychain; the frontend gets a snapshot
 * (name, plan, tokens left) and model calls ask `accessToken()` on the backend.
 */
@injectable()
export class IngotAccountBackend implements AccountBackend {

    @inject(KeyStoreService) protected readonly keyStore: KeyStoreService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected readonly keychainService = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;
    protected readonly clients = new Set<AccountClient>();
    protected currentUrls: AccountUrls = { serverUrl: process.env.INGOT_SERVER_URL || DEFAULT_SERVER_URL, portalUrl: process.env.INGOT_PORTAL_URL || DEFAULT_PORTAL_URL };
    protected session?: IngotAccountSession;
    protected current: AccountSnapshot = { signedIn: false, updatedAt: 0 };
    protected restored?: Promise<AccountSnapshot>;
    protected pending?: IdeSignInHandle;
    protected usageTimer?: ReturnType<typeof setTimeout>;
    protected pollTimer?: ReturnType<typeof setInterval>;
    /** From /api/me; undefined until fetched for this session. */
    protected role?: string;
    /** 403 account_blocked seen (IDEA-124); cleared by the next sign-in or sign-out. */
    protected blocked = false;

    setClient(client: AccountClient | undefined): void {
        if (client) {
            this.clients.add(client);
        }
    }

    removeClient(client: AccountClient): void {
        this.clients.delete(client);
    }

    dispose(): void {
        clearInterval(this.pollTimer);
        this.pending?.close();
    }

    protected get store(): IdeSessionStore {
        return {
            load: async () => {
                const raw = await this.keyStore.getPassword(this.keychainService, ACCOUNT_KEYCHAIN_KEY).catch(() => undefined);
                try {
                    return raw ? JSON.parse(raw) as IdeStoredSession : undefined;
                } catch {
                    return undefined;
                }
            },
            save: async session => { await this.keyStore.setPassword(this.keychainService, ACCOUNT_KEYCHAIN_KEY, JSON.stringify(session)); },
            clear: async () => { await this.keyStore.deletePassword(this.keychainService, ACCOUNT_KEYCHAIN_KEY).catch(() => false); }
        };
    }

    protected client(): IngotIdeClient {
        return new IngotIdeClient({ portalUrl: this.currentUrls.portalUrl, serverUrl: this.currentUrls.serverUrl, clientName: CLIENT_NAME });
    }

    protected ensureSession(): IngotAccountSession {
        if (!this.session) {
            this.session = new IngotAccountSession(this.client(), this.store);
            this.session.onChange(state => {
                if (!state.signedIn) {
                    this.role = undefined;
                    this.publish({ signedIn: false, updatedAt: Date.now() });
                    return;
                }
                const snapshot = snapshotOf(state.status);
                this.publish(this.withRole(snapshot));
                if (this.role === undefined) {
                    this.fetchRole().catch(() => undefined);
                }
            });
        }
        return this.session;
    }

    protected withRole(snapshot: AccountSnapshot): AccountSnapshot {
        return snapshot.user && this.role ? { ...snapshot, user: { ...snapshot.user, role: this.role } } : snapshot;
    }

    /** `role` comes from /api/me (the IDE status call does not carry it). */
    protected async fetchRole(): Promise<void> {
        const token = await this.ensureSession().accessToken();
        if (!token) {
            return;
        }
        const response = await fetch(`${this.currentUrls.serverUrl}/api/me`, { headers: { authorization: `Bearer ${token}`, ...ideHeaders(PRODUCT.version) }, signal: AbortSignal.timeout(10_000) });
        const json = await response.json().catch(() => ({})) as { error?: unknown };
        if (response.status === 403 && json.error === 'account_blocked') {
            await this.markBlocked();
            return;
        }
        if (response.ok) {
            this.role = roleOf(json) ?? 'user';
            if (this.current.signedIn) {
                this.publish(this.withRole(this.current));
            }
        }
    }

    /** 403 account_blocked anywhere: the server already revoked the session; forget it locally and stop background calls. */
    async markBlocked(): Promise<void> {
        if (this.blocked) {
            return;
        }
        this.blocked = true;
        this.role = undefined;
        await this.ensureSession().signOut(false).catch(() => undefined);
        this.publish({ signedIn: false, blocked: true, updatedAt: Date.now() });
    }

    protected isBlockedError(error: unknown): boolean {
        return error instanceof IdeAuthError && error.code === 'account_blocked';
    }

    protected publish(snapshot: AccountSnapshot): void {
        this.current = { ...snapshot, pending: !!this.pending && !snapshot.signedIn, ...(this.blocked ? { blocked: true, signedIn: false, user: undefined, tokens: undefined } : {}) };
        clearInterval(this.pollTimer);
        if (this.current.signedIn) {
            this.pollTimer = setInterval(() => this.refresh().catch(() => undefined), STATUS_POLL_MS);
        }
        for (const client of this.clients) {
            try {
                client.onDidChange(this.current);
            } catch {
                this.clients.delete(client);
            }
        }
    }

    protected async restore(): Promise<AccountSnapshot> {
        this.restored ??= this.ensureSession().restore()
            .then(() => this.current)
            .catch(async error => {
                if (this.isBlockedError(error)) {
                    await this.markBlocked();
                    return this.current;
                }
                // Server down: keep the stored session, show signed out with the reason.
                this.publish({ signedIn: false, updatedAt: Date.now(), error: this.describe(error) });
                return this.current;
            });
        return this.restored;
    }

    protected readonly defaults: AccountUrls = { serverUrl: process.env.INGOT_SERVER_URL || DEFAULT_SERVER_URL, portalUrl: process.env.INGOT_PORTAL_URL || DEFAULT_PORTAL_URL };

    async urls(): Promise<AccountUrls> {
        return this.currentUrls;
    }

    async configure(urls: AccountUrls): Promise<AccountSnapshot> {
        const next = { serverUrl: urls.serverUrl.replace(/\/$/, '') || this.defaults.serverUrl, portalUrl: urls.portalUrl.replace(/\/$/, '') || this.defaults.portalUrl };
        if (next.serverUrl !== this.currentUrls.serverUrl || next.portalUrl !== this.currentUrls.portalUrl) {
            this.currentUrls = next;
            this.session = undefined;
            this.restored = undefined;
        }
        return this.restore();
    }

    async snapshot(): Promise<AccountSnapshot> {
        return this.restore();
    }

    async signIn(options: SignInOptions = {}): Promise<string> {
        this.pending?.close();
        this.blocked = false;
        const handle = await this.client().beginSignIn();
        this.pending = handle;
        this.publish({ ...this.current, signedIn: false });
        const timeout = setTimeout(() => handle.close(), SIGN_IN_TIMEOUT_MS);
        handle.code
            .then(code => this.client().exchange(code, handle.verifier, handle.redirectUri))
            .then(tokens => { this.pending = undefined; return this.ensureSession().adopt(tokens); })
            .catch(error => {
                if (this.pending === handle) {
                    this.pending = undefined;
                    this.publish({ signedIn: false, updatedAt: Date.now(), error: this.describe(error) });
                }
            })
            .finally(() => { clearTimeout(timeout); handle.close(); });
        if (options.devEmail !== undefined) {
            if (!isLoopbackUrl(this.currentUrls.serverUrl) || !isLoopbackUrl(this.currentUrls.portalUrl)) {
                throw new Error('Dev sign-in only works with a local Ingot server.');
            }
            const authorize = new URL(handle.authorizeUrl);
            return devLoginUrl(this.currentUrls.portalUrl, options.devEmail || DEV_ACCOUNT_EMAIL, `${authorize.pathname}${authorize.search}`);
        }
        return handle.authorizeUrl;
    }

    async cancelSignIn(): Promise<void> {
        this.pending?.close();
        this.pending = undefined;
        this.publish({ ...this.current });
    }

    async handleDeepLink(url: string): Promise<boolean> {
        try {
            return await this.ensureSession().handleDeepLink(url);
        } catch (error) {
            this.publish({ signedIn: false, updatedAt: Date.now(), error: this.describe(error) });
            return false;
        }
    }

    async signOut(): Promise<void> {
        const wasBlocked = this.blocked;
        this.blocked = false;
        this.role = undefined;
        await this.ensureSession().signOut(!wasBlocked);
        if (wasBlocked) {
            this.publish({ signedIn: false, updatedAt: Date.now() });
        }
    }

    async refresh(): Promise<AccountSnapshot> {
        await this.restore();
        try {
            await this.ensureSession().refreshStatus();
        } catch (error) {
            if (this.isBlockedError(error)) {
                await this.markBlocked();
                return this.current;
            }
            this.publish({ ...this.current, error: this.describe(error) });
        }
        return this.current;
    }

    /** After every gateway call: usage changed, so refresh tokens used / left (debounced). */
    usageChanged(): void {
        clearTimeout(this.usageTimer);
        this.usageTimer = setTimeout(() => this.refresh().catch(() => undefined), USAGE_REFRESH_DELAY_MS);
    }

    async accessToken(): Promise<string | undefined> {
        await this.restore();
        return this.ensureSession().accessToken();
    }

    get gatewayBaseUrl(): string {
        return `${this.currentUrls.serverUrl}${GATEWAY_PATH}`;
    }

    async models(): Promise<GatewayModelInfo[]> {
        const token = await this.accessToken();
        if (!token) {
            return [];
        }
        const response = await fetch(`${this.gatewayBaseUrl}/models`, { headers: { authorization: `Bearer ${token}`, ...ideHeaders(PRODUCT.version) }, signal: AbortSignal.timeout(10_000) });
        if (response.status === 403) {
            const json = await response.json().catch(() => ({})) as { error?: { code?: unknown } | unknown };
            const code = json.error && typeof json.error === 'object' ? (json.error as { code?: unknown }).code : json.error;
            if (code === 'account_blocked') {
                await this.markBlocked();
            }
            return [];
        }
        if (!response.ok) {
            return [];
        }
        return parseGatewayModels(await response.json().catch(() => ({})));
    }

    protected async configCachePath(): Promise<string> {
        return path.join(FileUri.fsPath(await this.env.getConfigDirUri()), CONFIG_CACHE_FILE);
    }

    protected async cachedConfig(): Promise<RemoteConfigSnapshot> {
        try {
            const raw = JSON.parse(await fs.readFile(await this.configCachePath(), 'utf8')) as { config?: unknown; fetchedAt?: unknown; serverUrl?: unknown };
            if (raw.serverUrl === this.currentUrls.serverUrl) {
                return { config: parseRemoteConfig(raw.config, PRODUCT.version), source: 'cache', fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : 0 };
            }
        } catch {
            // No cache yet.
        }
        return { config: defaultRemoteConfig(PRODUCT.version), source: 'default', fetchedAt: 0 };
    }

    async remoteConfig(): Promise<RemoteConfigSnapshot> {
        if (this.blocked) {
            return this.cachedConfig();
        }
        const token = this.current.signedIn ? await this.accessToken().catch(() => undefined) : undefined;
        try {
            const response = await fetch(`${this.currentUrls.serverUrl}${CONFIG_PATH}`, {
                headers: { ...ideHeaders(PRODUCT.version), ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10_000)
            });
            const json = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
            if (response.status === 403 && json?.error === 'account_blocked') {
                await this.markBlocked();
                return this.cachedConfig();
            }
            if (!response.ok || !json) {
                return this.cachedConfig();
            }
            const fetchedAt = Date.now();
            const file = await this.configCachePath();
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, JSON.stringify({ serverUrl: this.currentUrls.serverUrl, fetchedAt, config: json }), 'utf8').catch(() => undefined);
            return { config: parseRemoteConfig(json, PRODUCT.version), source: 'server', fetchedAt };
        } catch {
            return this.cachedConfig();
        }
    }

    async syncRequest(method: 'GET' | 'PUT' | 'DELETE' | 'POST', path: string, body?: unknown): Promise<SyncResponse> {
        if (!['GET', 'PUT', 'DELETE', 'POST'].includes(method) || !(path === SYNC_PATH || path.startsWith(`${SYNC_PATH}/`) || path.startsWith(`${SYNC_PATH}?`)) || path.includes('..')) {
            return { status: 400, body: { error: 'invalid_sync_path' } };
        }
        if (this.blocked) {
            return { status: 403, body: { error: 'account_blocked' } };
        }
        const token = await this.accessToken().catch(() => undefined);
        if (!token) {
            return { status: 0, body: {} };
        }
        try {
            const response = await fetch(`${this.currentUrls.serverUrl}${path}`, {
                method,
                headers: { authorization: `Bearer ${token}`, ...ideHeaders(PRODUCT.version), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(20_000)
            });
            const json = await response.json().catch(() => ({})) as { error?: unknown };
            if (response.status === 403 && json.error === 'account_blocked') {
                await this.markBlocked();
            }
            return { status: response.status, body: json };
        } catch {
            return { status: 0, body: {} };
        }
    }

    protected describe(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        if (/fetch failed|ECONNREFUSED/i.test(message)) {
            return `Can't reach the Ingot server at ${this.currentUrls.serverUrl}.`;
        }
        return message === 'invalid_grant' ? 'Your session expired. Sign in again.' : message;
    }
}
