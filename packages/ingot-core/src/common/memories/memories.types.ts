export type MemoryScope = 'project' | 'global';

/** IDEA-267: a fact about the repository, or a preference of the user (how they like the work done). */
export type MemoryKind = 'fact' | 'preference';

export interface Memory {
    readonly id: string;
    readonly scope: MemoryScope;
    readonly kind: MemoryKind;
    readonly text: string;
    readonly createdAt: number;
}

/** A line the model asked to remember, before it is saved. */
export interface MemoryNote {
    readonly kind: MemoryKind;
    readonly text: string;
}
