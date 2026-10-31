/** IDEA-280: what to do after editing a sent prompt. */
export type EditRerunChoice = 'revert' | 'keep' | 'cancel';

export interface EditRerunPlan {
    /** Run the edited prompt again. */
    readonly rerun: boolean;
    /** Restore files to before the edited prompt first. */
    readonly revert: boolean;
}

/** The parts of a KeyboardEvent the key guard looks at. */
export interface KeyStroke {
    readonly key: string;
    readonly code: string;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
}

/** A click on a sent prompt either scrolls the pinned copy back to its place or opens the inline edit. */
export type PromptClickAction = 'reveal' | 'edit' | 'none';
