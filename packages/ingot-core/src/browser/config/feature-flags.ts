import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { AccountBackend } from '../../common/account/account-protocol';
import { PRODUCT } from '../../common/product.consts';
import type { RemoteConfigSnapshot } from '../../common/config/remote-config.types';
import { configValue, defaultRemoteConfig, flagEnabled, updateState } from '../../common/config/remote-config.utils';
import { IngotAccountService } from '../account/account-service';

/** Re-check on focus at most this often. */
const FOCUS_REFRESH_MS = 15_000;
const MS_PER_SECOND = 1000;

/**
 * Feature flags and remote config from GET /v1/config (IDEA-125): fetched at startup (signed in or out), every
 * `ttlSeconds`, on window focus and right after sign-in / sign-out; the backend keeps a disk cache for offline use.
 * Stops while the account is blocked.
 */
@injectable()
export class IngotFeatureFlags {

    @inject(AccountBackend) protected readonly backend: AccountBackend;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;

    protected current: RemoteConfigSnapshot = { config: defaultRemoteConfig(PRODUCT.version), source: 'default', fetchedAt: 0 };
    protected timer?: ReturnType<typeof setTimeout>;
    protected inFlight?: Promise<void>;
    protected lastAttempt = 0;
    protected signedIn?: boolean;
    protected readonly onDidChangeEmitter = new Emitter<RemoteConfigSnapshot>();
    readonly onDidChange: Event<RemoteConfigSnapshot> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.account.configure().then(() => this.refresh());
        this.account.onDidChange(() => {
            const snap = this.account.snapshot;
            if (snap.blocked) {
                clearTimeout(this.timer);
                return;
            }
            if (snap.signedIn !== this.signedIn) {
                this.signedIn = snap.signedIn;
                this.refresh();
            }
        });
        window.addEventListener('focus', () => {
            if (Date.now() - this.lastAttempt > FOCUS_REFRESH_MS) {
                this.refresh();
            }
        });
    }

    get snapshot(): RemoteConfigSnapshot {
        return this.current;
    }

    refresh(): Promise<void> {
        this.inFlight ??= this.load().finally(() => { this.inFlight = undefined; });
        return this.inFlight;
    }

    protected async load(): Promise<void> {
        clearTimeout(this.timer);
        if (this.account.blocked) {
            return;
        }
        this.lastAttempt = Date.now();
        try {
            this.current = await this.backend.remoteConfig();
            this.onDidChangeEmitter.fire(this.current);
        } catch {
            // Backend not ready: keep what we have and try again on the next tick.
        }
        this.timer = setTimeout(() => this.refresh(), this.current.config.ttlSeconds * MS_PER_SECOND);
    }

    /** Server flag, else the IDE's default for flags it knows; unknown flags are off. */
    enabled(flag: string): boolean {
        return flagEnabled(this.current.config, flag);
    }

    /** Variant / payload attached to a flag. */
    value<T = unknown>(flag: string): T | undefined {
        return this.current.config.values[flag] as T | undefined;
    }

    config<T>(key: string, fallback: T): T {
        return configValue(this.current.config, key, fallback);
    }

    /** The server no longer supports this build: agent and chat stay off until the user updates. */
    get forceUpdate(): boolean {
        return updateState(this.current.config.ide, PRODUCT.version) === 'force';
    }
}
