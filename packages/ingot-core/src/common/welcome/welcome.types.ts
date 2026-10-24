export interface RecentProject {
    readonly uri: string;
    readonly name: string;
    readonly path: string;
    readonly initials: string;
    /** `workspace` for `.ingot-workspace` / `.code-workspace` files, otherwise a folder. */
    readonly kind: 'folder' | 'workspace';
}

export type WelcomeTab = 'projects' | 'customize' | 'plugins' | 'learn';
