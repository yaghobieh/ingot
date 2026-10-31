import type { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export interface AutoUpdateEnvironment {
    /** Electron `app.isPackaged`: false for `npm run start:electron` dev runs. */
    readonly isPackaged: boolean;
    readonly platform: NodeJS.Platform;
    readonly version: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}

export interface AutoUpdateDecision {
    readonly enabled: boolean;
    /** Why updates are off (for the log and the Check for Updates message); undefined when enabled. */
    readonly reason?: AutoUpdateSkipReason;
    /** Channel used until the user picks one in `ingot.update.channel`: pre-release builds follow beta. */
    readonly defaultChannel: UpdateChannel;
    /** Dev/e2e only: pretend this version is published (no network, no installer). */
    readonly simulatedVersion?: string;
}

export type AutoUpdateSkipReason = 'dev-build' | 'disabled-by-env' | 'linux-package-manager';

/** `stable` follows GitHub releases; `beta` also follows pre-releases (`v0.2.0-beta.1`). */
export type UpdateChannel = 'stable' | 'beta';

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'downloaded' | 'error';

export interface UpdateStatus {
    readonly state: UpdateState;
    /** The running app version (the real one, e.g. `0.1.0-beta.1`). */
    readonly currentVersion: string;
    readonly channel: UpdateChannel;
    /** The version being downloaded / ready to install. */
    readonly version?: string;
    /** Download progress 0..100 while `downloading`. */
    readonly percent?: number;
    /** The server's minVersion is newer than this build: the update is mandatory. */
    readonly required: boolean;
    readonly minVersion?: string;
    readonly reason?: AutoUpdateSkipReason;
    readonly error?: string;
}

/** Frontend side of the updater RPC: the main process pushes every status change. */
export interface IngotUpdaterClient {
    onStatusChanged(status: UpdateStatus): void;
}

/** Electron-main updater, reached from the frontend over Electron IPC. */
export interface IngotUpdaterService extends RpcServer<IngotUpdaterClient> {
    getStatus(): Promise<UpdateStatus>;
    checkForUpdates(): Promise<UpdateStatus>;
    /** `undefined` = the user never picked a channel: use the build's default. */
    setChannel(channel: UpdateChannel | undefined): Promise<UpdateStatus>;
    /** Server-side minimum version (ingot-server GET /v1/config `ide.minVersion`): forces the update when newer. */
    enforceMinVersion(minVersion: string): Promise<UpdateStatus>;
    restartToUpdate(): Promise<void>;
}

/** What the update controller hears from electron-updater (or the dev/e2e simulation). */
export interface UpdateDriverListener {
    onChecking(): void;
    onAvailable(version: string): void;
    onNotAvailable(): void;
    onProgress(percent: number): void;
    onDownloaded(version: string): void;
    onError(message: string): void;
}

export interface UpdateDriver {
    check(allowPrerelease: boolean): Promise<void>;
    quitAndInstall(): void;
}

export type UpdateDriverFactory = (listener: UpdateDriverListener, decision: AutoUpdateDecision) => UpdateDriver;
