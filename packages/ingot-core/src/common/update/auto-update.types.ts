export interface AutoUpdateEnvironment {
    /** Electron `app.isPackaged`: false for `npm run start:electron` dev runs. */
    readonly isPackaged: boolean;
    readonly platform: NodeJS.Platform;
    readonly version: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}

export interface AutoUpdateDecision {
    readonly enabled: boolean;
    /** Why updates are off (for the log); undefined when enabled. */
    readonly reason?: AutoUpdateSkipReason;
    /** Pre-release builds (0.1.0-beta.1) also follow newer pre-releases; stable builds only follow stable releases. */
    readonly allowPrerelease: boolean;
}

export type AutoUpdateSkipReason = 'dev-build' | 'disabled-by-env' | 'linux-package-manager';
