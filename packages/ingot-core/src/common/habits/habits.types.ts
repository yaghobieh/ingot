/**
 * IDEA-296 Habits: patterns Ingot notices in how the user works (local only), proposed as a rule, command or hook
 * once they repeat.
 */
export type HabitKind = 'instruction' | 'command' | 'rejection';
export type HabitStatus = 'learning' | 'proposed' | 'accepted' | 'dismissed';
export type HabitTarget = 'rule' | 'command' | 'hook';

export interface Habit {
    readonly id: string;
    readonly kind: HabitKind;
    /** Normalized pattern, unique per habit (`instruction:use bear components`). */
    readonly key: string;
    /** Short description: `use Bear components`, `npm test`, `add console.log calls`. */
    readonly label: string;
    /** The rule text a rule or command would hold. */
    readonly text: string;
    readonly count: number;
    /** Latest evidence (prompts, commands, rejected lines), newest last. */
    readonly examples: readonly string[];
    /** Off: no longer counted or proposed. */
    readonly enabled: boolean;
    readonly status: HabitStatus;
    readonly firstSeen: number;
    readonly lastSeen: number;
    /** File written when accepted (`.ingot/rules/use-bear-components.md`). */
    readonly savedAs?: string;
}

/** One observation fed to `recordEvidence`. */
export interface HabitEvidence {
    readonly kind: HabitKind;
    readonly key: string;
    readonly label: string;
    readonly text: string;
    readonly example: string;
}

export interface HabitsFile {
    readonly version: number;
    readonly habits: readonly Habit[];
}

export interface HabitFile {
    readonly path: string;
    readonly content: string;
}

/** What Undo on a "Saved to Habits" note puts back. */
export interface HabitUndo {
    /** The learned pattern this note is about. */
    readonly habitId?: string;
    /** The pattern as it was before; absent when it was new, so Undo forgets it. */
    readonly previous?: Habit;
    /** Rule or command file this save created (URI). */
    readonly created?: string;
    /** Habit playbook file this save created (URI). */
    readonly playbook?: string;
    /** Command this save added to the `stop` hook in hooks.json. */
    readonly hook?: string;
}

export type HabitNoteKind = 'learned' | 'saved';

/** The subtle "Saved to Habits" line in the agent chat when Habits learns or saves a pattern. */
export interface HabitNote {
    readonly kind: HabitNoteKind;
    readonly label: string;
    /** File the pattern was saved as, when there is one. */
    readonly savedAs?: string;
    /** What the Habits page scrolls to: `learned:<id>` or a playbook id (`project:<slug>`). */
    readonly focus: string;
    readonly undo: HabitUndo;
    readonly undone?: boolean;
}
