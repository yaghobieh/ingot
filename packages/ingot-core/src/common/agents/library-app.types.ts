/** React layouts a new library app can follow. */
export type ReactStructure = 'feature-folders' | 'atomic';

/** Node layouts a new library app can follow. */
export type NodeStructure = 'layered' | 'modular';

export interface LibraryFile {
    readonly path: string;
    readonly content: string;
}

/** What a create-library prompt already decided, and what is still missing. */
export interface LibraryPrompt {
    readonly path?: string;
    readonly react?: ReactStructure;
    readonly node?: NodeStructure;
    /** Example folder the user pointed at for the React layout. */
    readonly reactExample?: string;
    /** Example folder the user pointed at for the Node layout. */
    readonly nodeExample?: string;
    readonly ambiguous: boolean;
}

export interface LibraryPlan {
    readonly path: string;
    readonly react: ReactStructure;
    readonly node: NodeStructure;
    /** Write AGENTS.md and a skills folder. Set when the prompt asks for rules or skills. */
    readonly rules?: boolean;
}
