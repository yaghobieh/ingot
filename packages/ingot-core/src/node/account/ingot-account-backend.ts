import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { DEFAULT_KEYCHAIN_SERVICE } from '../../common/models/models.consts';
import type { AccountBackend, AccountClient, AccountSnapshot, AccountUrls, GatewayModelInfo, SignInOptions } from '../../common/account/account-protocol';
import {
    ACCOUNT_KEYCHAIN_KEY, DEFAULT_PORTAL_URL, DEFAULT_SERVER_URL, DEV_ACCOUNT_EMAIL, GATEWAY_PATH, SIGN_IN_TIMEOUT_MS, STATUS_POLL_MS, USAGE_REFRESH_DELAY_MS
} from '../../common/account/account.consts';
import { devLoginUrl, isLoopbackUrl, parseGatewayModels, snapshotOf } from '../../common/account/gateway.utils';
import { IngotAccountSession, IngotIdeClient, type IdeSessionStore, type IdeSignInHandle, type IdeStoredSession } from './ide-client';

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
            this.session.onChange(state => this.publish(state.signedIn ? snapshotOf(state.status) : { signedIn: false, updatedAt: Date.now() }));
        }
        return this.session;
    }

    protected publish(snapshot: AccountSnapshot): void {
        this.current = { ...snapshot, pending: !!this.pending && !snapshot.signedIn };
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
            .catch(error => {
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
        await this.ensureSession().signOut();
    }

    async refresh(): Promise<AccountSnapshot> {
        await this.restore();
        try {
            await this.ensureSession().refreshStatus();
        } catch (error) {
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
        const response = await fetch(`${this.gatewayBaseUrl}/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
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
