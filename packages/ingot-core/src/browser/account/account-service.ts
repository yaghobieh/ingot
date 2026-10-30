import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type { IngotAccount } from '../../common/account/account.types';
import { AccountBackend, type AccountSnapshot, type GatewayModelInfo } from '../../common/account/account-protocol';
import { billingUrl } from '../../common/account/gateway-errors';
import { ACCOUNT_PREFERENCES, AVATAR_CACHE_KEY, AVATAR_CACHE_MAX_BYTES, DEFAULT_PORTAL_URL, DEFAULT_SERVER_URL, DEV_ACCOUNT_EMAIL } from '../../common/account/account.consts';
import type { AvatarCache } from '../../common/account/avatar.types';
import { avatarSource, isImageDataUrl, needsAvatarRefresh, parseAvatarCache, safeAvatarUrl } from '../../common/account/avatar.utils';
import { isLoopbackUrl } from '../../common/account/gateway.utils';
import { isProPlusPlan } from '../../common/account/plan.utils';
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
    /** IDEA-143: local copy of the provider photo (data URL in localStorage). */
    protected avatarCache: AvatarCache | undefined = parseAvatarCache(localStorage.getItem(AVATAR_CACHE_KEY));
    protected avatarFetching?: string;

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
        this.syncAvatar();
    }

    /** Every snapshot (sign-in, sync, status refresh) re-checks the photo; signing out forgets it. */
    protected syncAvatar(): void {
        if (!this.current.signedIn) {
            if (this.avatarCache && !this.current.pending) {
                this.avatarCache = undefined;
                localStorage.removeItem(AVATAR_CACHE_KEY);
            }
            return;
        }
        const url = safeAvatarUrl(this.current.user?.avatarUrl);
        if (!needsAvatarRefresh(this.avatarCache, url, Date.now()) || this.avatarFetching === url) {
            return;
        }
        this.avatarFetching = url;
        this.cacheAvatar(url).finally(() => { this.avatarFetching = undefined; });
    }

    protected async cacheAvatar(url: string): Promise<void> {
        try {
            const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            const blob = response.ok ? await response.blob() : undefined;
            if (!blob || blob.size > AVATAR_CACHE_MAX_BYTES || !blob.type.startsWith('image/')) {
                return;
            }
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
            if (!isImageDataUrl(dataUrl) || safeAvatarUrl(this.current.user?.avatarUrl) !== url) {
                return;
            }
            this.avatarCache = { url, dataUrl, savedAt: Date.now() };
            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(this.avatarCache));
            this.onDidChangeEmitter.fire(this.account);
        } catch {
            // Offline or the photo host refuses cross-origin reads: the <img> loads the URL directly instead.
        }
    }

    /** What avatars show: the cached photo, else the provider URL, else '' (initials). */
    get avatarSrc(): string {
        return this.current.signedIn ? avatarSource(this.avatarCache, safeAvatarUrl(this.current.user?.avatarUrl)) : '';
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

    /** The signed-in session is on the PRO+ plan (the Zaprex app is a PRO+ feature). */
    get proPlus(): boolean {
        return this.current.signedIn && isProPlusPlan(this.current.user?.plan);
    }

    /** Name and email for the avatar (kept for the stripe and menus). */
    get account(): IngotAccount | undefined {
        const user = this.current.user;
        return this.current.signedIn && user ? { name: user.name, email: user.email, avatarUrl: safeAvatarUrl(user.avatarUrl) || undefined } : undefined;
    }

    /** Dev sign-in shows only against a local server. */
    get devSignInAvailable(): boolean {
        return isLoopbackUrl(this.urls.serverUrl) && isLoopbackUrl(this.urls.portalUrl);
    }

    async signIn(dev = false): Promise<void> {
        await this.configure();
        const url = await this.backend.signIn(dev ? { devEmail: DEV_ACCOUNT_EMAIL } : {});
        this.apply({ ...this.current, pending: true });
        if (url) {
            // Empty = the backend already finished a local dev sign-in.
            this.windows.openNewWindow(url, { external: true });
        }
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

    get isAdmin(): boolean {
        return this.current.signedIn && this.current.user?.role === 'admin';
    }

    get blocked(): boolean {
        return !!this.current.blocked;
    }

    /** Admin powers are website-only (IDEA-124); this opens the portal's back-office (IDEA-129). */
    openAdmin(): void {
        this.windows.openNewWindow(`${this.urls.portalUrl.replace(/\/$/, '')}/backoffice`, { external: true });
    }

    /** Plans, top-ups and Manage subscription on the portal (IDEA-147). */
    openBilling(): void {
        this.windows.openNewWindow(billingUrl(this.urls.portalUrl), { external: true });
    }

    openDashboard(): void {
        this.windows.openNewWindow(`${this.urls.portalUrl.replace(/\/$/, '')}/dashboard`, { external: true });
    }
}
