import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
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

    protected describe(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        if (/fetch failed|ECONNREFUSED/i.test(message)) {
            return `Can't reach the Ingot server at ${this.currentUrls.serverUrl}.`;
        }
        return message === 'invalid_grant' ? 'Your session expired. Sign in again.' : message;
    }
}
