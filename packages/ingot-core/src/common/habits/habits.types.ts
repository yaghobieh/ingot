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

export type HabitNoteKind = 'habit' | 'decision' | 'frozen' | 'handoff' | 'plan' | 'route';
/** What a note's action button does (IDEA-305..307): open a file, or run the turn again on the original model. */
export type HabitNoteAction = 'open-file' | 'use-original';

/**
 * The one silver line in the agent chat when something is saved or decided: "Saved to Habits" (IDEA-296), "Locked in
 * Decisions", "Frozen" (IDEA-302..304), "Fresh context - handed off", "Checked against plan", "Routed to cheaper model"
 * (IDEA-305..307). A habit note opens the habit on the Habits page.
 */
export interface HabitNoteInfo {
    readonly kind: HabitNoteKind;
    /** Defaults to the kind's text (`HABIT_NOTE_TEXT`). */
    readonly text?: string;
    /** What was saved: the pattern, the decision, the frozen zone, the failed approach. */
    readonly detail?: string;
    /** Id of the saved item, for the note's undo (unlock, unfreeze). */
    readonly ref?: string;
    /** What the Habits page scrolls to: `learned:<id>` or a playbook id (`project:<slug>`). */
    readonly focus?: string;
    /** What Undo on a "Saved to Habits" note puts back. */
    readonly undo?: HabitUndo;
    readonly undone?: boolean;
    /** Project-relative file the note points at (brief, plan, template). */
    readonly path?: string;
    readonly action?: HabitNoteAction;
    readonly actionLabel?: string;
    /** True once the action ran (the button hides). */
    readonly done?: boolean;
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

export type HabitEventKind = 'learned' | 'saved';

/** Habits learned or saved a pattern (`HabitStore.onDidNote`); the chat shows it as a "Saved to Habits" note. */
export interface HabitEvent {
    readonly kind: HabitEventKind;
    readonly label: string;
    /** File the pattern was saved as, when there is one. */
    readonly savedAs?: string;
    /** What the Habits page scrolls to: `learned:<id>` or a playbook id (`project:<slug>`). */
    readonly focus: string;
    readonly undo: HabitUndo;
}
