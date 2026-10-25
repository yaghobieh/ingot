import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type { IngotAccount } from '../../common/account/account.types';
import { AccountBackend, type AccountSnapshot, type GatewayModelInfo } from '../../common/account/account-protocol';
import { ACCOUNT_PREFERENCES, DEFAULT_PORTAL_URL, DEFAULT_SERVER_URL, DEV_ACCOUNT_EMAIL } from '../../common/account/account.consts';
import { isLoopbackUrl } from '../../common/account/gateway.utils';
import { IngotAccountClient } from './account-client';

/** The signed-in Ingot account as the UI sees it (IDEA-92, IDEA-101). Tokens stay on the backend / keychain. */
@injectable()
export class IngotAccountService {

    @inject(AccountBackend) protected readonly backend: AccountBackend;
    @inject(IngotAccountClient) protected readonly client: IngotAccountClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(WindowService) protected readonly windows: WindowService;

    protected readonly onDidChangeEmitter = new Emitter<IngotAccount | undefined>();
    /** Fires on every snapshot change (sign-in, sign-out, usage refresh). */
    readonly onDidChange = this.onDidChangeEmitter.event;
    protected current: AccountSnapshot = { signedIn: false, updatedAt: 0 };
    protected configured?: Promise<void>;
    protected backendUrls?: { serverUrl: string; portalUrl: string };

    @postConstruct()
    protected init(): void {
        this.client.onDidChangeSnapshot(snapshot => this.apply(snapshot));
        this.preferences.ready.then(() => this.configure());
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === ACCOUNT_PREFERENCES.serverUrl || e.preferenceName === ACCOUNT_PREFERENCES.portalUrl) {
                this.configured = undefined;
                this.configure();
            }
        });
    }

    protected apply(snapshot: AccountSnapshot): void {
        this.current = snapshot;
        this.onDidChangeEmitter.fire(this.account);
    }

    /** URLs the user set explicitly ('' = keep the backend's default, which INGOT_SERVER_URL / INGOT_PORTAL_URL can change). */
    protected explicit(name: string): string {
        const inspected = this.preferences.inspect<string>(name);
        return inspected?.workspaceValue ?? inspected?.globalValue ?? '';
    }

    get urls(): { serverUrl: string; portalUrl: string } {
        return { serverUrl: this.backendUrls?.serverUrl ?? DEFAULT_SERVER_URL, portalUrl: this.backendUrls?.portalUrl ?? DEFAULT_PORTAL_URL };
    }

    configure(): Promise<void> {
        this.configured ??= this.backend.configure({ serverUrl: this.explicit(ACCOUNT_PREFERENCES.serverUrl), portalUrl: this.explicit(ACCOUNT_PREFERENCES.portalUrl) })
            .then(async s => { this.backendUrls = await this.backend.urls(); this.apply(s); }, () => undefined);
        return this.configured;
    }

    get snapshot(): AccountSnapshot {
        return this.current;
    }

    get signedIn(): boolean {
        return this.current.signedIn;
    }

    /** Name and email for the avatar (kept for the stripe and menus). */
    get account(): IngotAccount | undefined {
        const user = this.current.user;
        return this.current.signedIn && user ? { name: user.name, email: user.email } : undefined;
    }

    /** Dev sign-in shows only against a local server. */
    get devSignInAvailable(): boolean {
        return isLoopbackUrl(this.urls.serverUrl) && isLoopbackUrl(this.urls.portalUrl);
    }

    async signIn(dev = false): Promise<void> {
        await this.configure();
        const url = await this.backend.signIn(dev ? { devEmail: DEV_ACCOUNT_EMAIL } : {});
        this.apply({ ...this.current, pending: true });
        this.windows.openNewWindow(url, { external: true });
    }

    async cancelSignIn(): Promise<void> {
        await this.backend.cancelSignIn();
    }

    async signOut(): Promise<void> {
        await this.backend.signOut();
    }

    async refresh(): Promise<AccountSnapshot> {
        await this.configure();
        const snapshot = await this.backend.refresh();
        this.apply(snapshot);
        return snapshot;
    }

    async models(): Promise<GatewayModelInfo[]> {
        await this.configure();
        return this.current.signedIn ? this.backend.models() : [];
    }

    openDashboard(): void {
        this.windows.openNewWindow(`${this.urls.portalUrl.replace(/\/$/, '')}/dashboard`, { external: true });
    }
}
