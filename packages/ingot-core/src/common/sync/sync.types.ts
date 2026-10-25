/** /v1/sync (IDEA-126, contract §4). */
export type SyncKind = 'settings' | 'rules' | 'keybindings' | 'chats';

export interface SyncItem {
    readonly kind: SyncKind;
    readonly key: string;
    readonly data: unknown;
    readonly version: number;
    readonly deleted: boolean;
    readonly device?: string | null;
    readonly updatedAt?: string;
}

/** What this install last saw per item: the version (for `baseVersion`) and a hash of the data (to skip no-op pushes). */
export interface SyncState {
    cursor: number;
    versions: Record<string, number>;
    hashes: Record<string, string>;
}

export interface SyncPush {
    readonly kind: SyncKind;
    readonly key: string;
    readonly data: unknown;
    readonly baseVersion?: number;
}

export interface SyncDelete {
    readonly kind: SyncKind;
    readonly key: string;
    readonly baseVersion?: number;
}

/** A sync HTTP exchange through the backend (the token never reaches the frontend). */
export interface SyncResponse {
    readonly status: number;
    readonly body: unknown;
}

/** Chat list metadata only; never message bodies. */
export interface ChatMeta {
    readonly title: string;
    readonly pinned: boolean;
    readonly order: number;
    readonly updatedAt: number;
}
