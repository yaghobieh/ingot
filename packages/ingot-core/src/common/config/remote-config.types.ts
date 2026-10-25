/** GET /v1/config (IDEA-125, contract §3). */
export interface IdeUpdatePolicy {
    readonly version: string;
    readonly minVersion: string | null;
    readonly latestVersion: string | null;
    readonly updateAvailable: boolean;
    readonly forceUpdate: boolean;
    readonly downloadUrl: string;
    readonly releaseNotesUrl: string | null;
}

export interface RemoteConfig {
    readonly flags: Readonly<Record<string, boolean>>;
    readonly values: Readonly<Record<string, unknown>>;
    readonly config: Readonly<Record<string, unknown>>;
    readonly ide: IdeUpdatePolicy;
    readonly ttlSeconds: number;
    readonly signedIn: boolean;
}

/** What the backend hands the frontend: the config plus where it came from. */
export interface RemoteConfigSnapshot {
    readonly config: RemoteConfig;
    /** `server` = fresh, `cache` = last good response from disk (offline), `default` = never reached the server. */
    readonly source: 'server' | 'cache' | 'default';
    /** Epoch ms of the response. */
    readonly fetchedAt: number;
}
