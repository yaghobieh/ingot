export interface RecentProject {
    readonly uri: string;
    readonly name: string;
    readonly path: string;
    readonly initials: string;
    /** `group` for `.ingot-group`, `workspace` for `.ingot-workspace` / `.code-workspace` files, otherwise a folder. */
    readonly kind: 'folder' | 'workspace' | 'group';
}

export type SuggestionState = 'idle' | 'installing' | 'installed' | 'failed';
