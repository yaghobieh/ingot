export interface RecentProject {
    readonly uri: string;
    readonly name: string;
    readonly path: string;
    readonly initials: string;
    /** `group` for `.ingot-group`, `workspace` for `.ingot-workspace` / `.code-workspace` files, otherwise a folder. */
    readonly kind: 'folder' | 'workspace' | 'group';
}

/** IDEA-266: where Connect via SSH connects (`user@host`, optional port). */
export interface SshTarget {
    readonly destination: string;
    readonly port?: number;
}
