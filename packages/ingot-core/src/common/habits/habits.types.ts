/**
 * IDEA-296 Habits: patterns Ingot notices in how the user works (local only), proposed as a rule, command or hook
 * once they repeat.
 */
export type HabitKind = 'instruction' | 'command' | 'rejection' | SavedHabitKind;
/** IDEA-302..304: habits saved straight from a feature (a promoted decision, a learned freeze, a failed approach). */
export type SavedHabitKind = 'decision' | 'frozen' | 'anti';
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

/** A habit that is already saved somewhere (`.ingot/decisions.md`, `.ingot/frozen.json`, `.ingot/anti-habits.md`). */
export interface SavedHabit {
    readonly kind: SavedHabitKind;
    readonly key: string;
    readonly label: string;
    readonly text: string;
    readonly example: string;
    readonly savedAs: string;
}

export type HabitNoteKind = 'decision' | 'frozen' | 'habit';

/** IDEA-302..304: the small silver line in the chat when something is saved ("Locked in Decisions", "Frozen", "Saved to Habits"). */
export interface HabitNoteInfo {
    readonly kind: HabitNoteKind;
    readonly text: string;
    /** What was saved: the decision, the frozen zone, the failed approach. */
    readonly detail?: string;
    /** Id of the saved item, for the note's undo (unlock, unfreeze). */
    readonly ref?: string;
    readonly undone?: boolean;
}

export interface HabitsFile {
    readonly version: number;
    readonly habits: readonly Habit[];
}

export interface HabitFile {
    readonly path: string;
    readonly content: string;
}
