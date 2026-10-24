export interface RecentProject {
    readonly uri: string;
    readonly name: string;
    readonly path: string;
    readonly initials: string;
}

export type WelcomeTab = 'projects' | 'customize' | 'plugins' | 'learn';
