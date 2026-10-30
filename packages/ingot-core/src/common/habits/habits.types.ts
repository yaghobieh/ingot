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
