import type { ZaprexPlatform } from './handoff';

/** One way to start the Zaprex desktop app; tried in order until one succeeds. */
export interface ZaprexLaunchStep {
    readonly cmd: string;
    readonly args: readonly string[];
    /** Only tried when this file exists (an install location). */
    readonly requires?: string;
    /** The command is the app itself: spawn it detached instead of waiting for it to exit. */
    readonly detached?: boolean;
}

/** Where the app may be installed, per OS (from the backend's environment). */
export interface ZaprexLaunchDirs {
    readonly platform: ZaprexPlatform;
    readonly home: string;
    readonly localAppData?: string;
    readonly programFiles?: string;
}
