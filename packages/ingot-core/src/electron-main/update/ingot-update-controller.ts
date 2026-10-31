import { AUTO_UPDATE_FIRST_CHECK_MS, AUTO_UPDATE_INTERVAL_MS } from '../../common/update/auto-update.consts';
import type {
    AutoUpdateDecision, IngotUpdaterClient, IngotUpdaterService, UpdateChannel, UpdateDriver, UpdateDriverFactory, UpdateDriverListener, UpdateStatus
} from '../../common/update/auto-update.types';
import { allowPrereleaseFor, isBelowMinVersion, resolveChannel } from '../../common/update/auto-update.utils';

const BUSY_STATES: ReadonlySet<UpdateStatus['state']> = new Set(['checking', 'downloading', 'downloaded']);

/**
 * Desktop auto-update (IDEA-134, IDEA-269): checks on startup and every 4 hours, downloads in the background, tells every
 * window when the update is ready, and installs on restart (or on the next quit). A server minVersion forces the update.
 * Pure of Electron: the driver wraps electron-updater (or the dev/e2e simulation).
 */
export class IngotUpdateController implements IngotUpdaterService {

    protected readonly clients = new Set<IngotUpdaterClient>();
    protected driver: UpdateDriver | undefined;
    protected firstCheck: ReturnType<typeof setTimeout> | undefined;
    protected interval: ReturnType<typeof setInterval> | undefined;
    protected status: UpdateStatus;

    constructor(readonly decision: AutoUpdateDecision, protected readonly version: string, protected readonly createDriver: UpdateDriverFactory) {
        this.status = decision.enabled
            ? { state: 'idle', currentVersion: version, channel: decision.defaultChannel, required: false }
            : { state: 'disabled', currentVersion: version, channel: decision.defaultChannel, required: false, reason: decision.reason };
    }

    get enabled(): boolean {
        return this.decision.enabled;
    }

    /** Starts the schedule (no-op when updates are off). */
    start(): void {
        if (!this.enabled || this.interval) {
            return;
        }
        this.firstCheck = setTimeout(() => this.checkForUpdates(), AUTO_UPDATE_FIRST_CHECK_MS);
        this.interval = setInterval(() => this.checkForUpdates(), AUTO_UPDATE_INTERVAL_MS);
    }

    dispose(): void {
        clearTimeout(this.firstCheck);
        clearInterval(this.interval);
        this.firstCheck = undefined;
        this.interval = undefined;
        this.clients.clear();
    }

    setClient(client: IngotUpdaterClient | undefined): void {
        if (client) {
            this.addClient(client);
        }
    }

    addClient(client: IngotUpdaterClient): void {
        this.clients.add(client);
    }

    removeClient(client: IngotUpdaterClient): void {
        this.clients.delete(client);
    }

    async getStatus(): Promise<UpdateStatus> {
        return this.status;
    }

    async checkForUpdates(): Promise<UpdateStatus> {
        if (!this.enabled || BUSY_STATES.has(this.status.state)) {
            return this.status;
        }
        this.driver ??= this.createDriver(this.listener, this.decision);
        this.update({ state: 'checking', error: undefined, percent: undefined });
        try {
            await this.driver.check(allowPrereleaseFor(this.status.channel, this.status.required ? this.status.minVersion : undefined));
        } catch (error) {
            this.listener.onError(error instanceof Error ? error.message : String(error));
        }
        return this.status;
    }

    async setChannel(channel: UpdateChannel | undefined): Promise<UpdateStatus> {
        const next = resolveChannel(channel, this.version);
        if (next !== this.status.channel) {
            this.update({ channel: next });
        }
        return this.status;
    }

    async enforceMinVersion(minVersion: string): Promise<UpdateStatus> {
        if (!isBelowMinVersion(this.version, minVersion) || (this.status.required && this.status.minVersion === minVersion)) {
            return this.status;
        }
        this.update({ required: true, minVersion });
        // A required update never waits for the next scheduled check.
        return this.checkForUpdates();
    }

    async restartToUpdate(): Promise<void> {
        if (this.status.state === 'downloaded') {
            this.driver?.quitAndInstall();
        }
    }

    protected readonly listener: UpdateDriverListener = {
        onChecking: () => this.update({ state: 'checking' }),
        onAvailable: version => this.update({ state: 'downloading', version, percent: 0 }),
        onNotAvailable: () => this.update({ state: 'up-to-date', version: undefined, percent: undefined }),
        onProgress: percent => this.update({ state: 'downloading', percent: Math.round(percent) }),
        onDownloaded: version => this.update({ state: 'downloaded', version, percent: undefined }),
        onError: error => {
            console.warn('[ingot] auto-update error', error);
            // A failed check after a finished download keeps the update installable.
            if (this.status.state !== 'downloaded') {
                this.update({ state: 'error', error });
            }
        }
    };

    protected update(patch: Partial<UpdateStatus>): void {
        this.status = { ...this.status, ...patch };
        for (const client of this.clients) {
            try {
                client.onStatusChanged(this.status);
            } catch {
                this.clients.delete(client);
            }
        }
    }
}
