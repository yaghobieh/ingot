/**
 * IDEA-296 Habits v2: a habit is a scenario playbook, "what to do in which scenario" (for example: bug in payments →
 * search the logs, check the service, run the tests). Kept as Markdown with frontmatter in `.ingot/habits/*.md`
 * (committed, shared with the team) or in the user's `habits` config folder (every project).
 */
export type PlaybookSource = 'project' | 'global' | 'cursor';

/** Settings page scopes that can be added to. */
export type PlaybookScope = Extract<PlaybookSource, 'project' | 'global'>;

export interface Playbook {
    /** `<source>:<slug>`, unique across folders. */
    readonly id: string;
    readonly name: string;
    /** File name without `.md`. */
    readonly slug: string;
    /** Natural-language trigger: the scenario this habit is for. */
    readonly when: string;
    readonly globs: readonly string[];
    readonly keywords: readonly string[];
    readonly errorRegex?: string;
    /** Ordered steps the agent follows and ticks off. */
    readonly steps: readonly string[];
    /** Tools the agent may call while the habit is active (empty: all). */
    readonly allowedTools: readonly string[];
    /** Checked before the agent finishes. */
    readonly doneCriteria: readonly string[];
    /** Markdown after the frontmatter, sent with the steps. */
    readonly notes: string;
    readonly source: PlaybookSource;
    /** Display path (`.ingot/habits/payments-bug.md`, `~/.ingot/habits/x.md`). */
    readonly path: string;
    readonly uri?: string;
}

/** The editable fields of a habit (what the editor and the save-as-habit draft produce). */
export interface PlaybookDraft {
    readonly name: string;
    readonly when: string;
    readonly globs: readonly string[];
    readonly keywords: readonly string[];
    readonly errorRegex?: string;
    readonly steps: readonly string[];
    readonly allowedTools: readonly string[];
    readonly doneCriteria: readonly string[];
    readonly notes: string;
}

export interface PlaybookParseResult {
    /** Set when the file is valid (no errors). */
    readonly playbook?: Playbook;
    readonly errors: readonly string[];
    /** Not fatal: unknown keys and the like. */
    readonly warnings: readonly string[];
}

/** A habit file that did not load, shown on the Habits page with its errors. */
export interface PlaybookFileError {
    readonly path: string;
    readonly source: PlaybookSource;
    readonly uri?: string;
    readonly errors: readonly string[];
}

export interface PlaybookList {
    readonly playbooks: readonly Playbook[];
    readonly errors: readonly PlaybookFileError[];
}

/** What the deterministic matcher looks at for one turn. */
export interface HabitSignals {
    /** The prompt as typed. */
    readonly prompt: string;
    /** Attached text (code chips, pasted output) searched for errors. */
    readonly attachments?: string;
    /** Attached, mentioned and open files (project-relative). */
    readonly files: readonly string[];
    readonly diagnostics: readonly HabitDiagnostic[];
    /** Error lines from the integrated terminal. */
    readonly terminalErrors: readonly string[];
}

export interface HabitDiagnostic {
    readonly path: string;
    readonly message: string;
}

export interface PlaybookMatch {
    readonly playbook: Playbook;
    readonly score: number;
    /** Why it matched: `keyword "payments"`, `error in terminal`, `file src/payments/api.ts`. */
    readonly reasons: readonly string[];
}

/** Who chose the habit: the matcher, the model (use_habit) or the user (pill). */
export type HabitPick = 'auto' | 'agent' | 'user';

export interface HabitCheck {
    readonly text: string;
    readonly done: boolean;
}

/** The habit a chat follows, with its live checklist. Saved with the chat. */
export interface ActiveHabit {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly steps: readonly HabitCheck[];
    readonly criteria: readonly HabitCheck[];
    readonly allowedTools: readonly string[];
    readonly pickedBy: HabitPick;
    readonly reason?: string;
    /** Turned off by the user for this chat: kept so it is not picked again automatically. */
    readonly off?: boolean;
    /** Done-criteria reminders sent in the current turn. */
    readonly nudged?: number;
}

/** Ticks the agent wrote in a reply (`HABIT-STEP: 2`, `HABIT-DONE: 1`), 1-based. */
export interface HabitMarks {
    readonly steps: readonly number[];
    readonly done: readonly number[];
}

/** One tool call of a finished run, for "Save this run as a habit". */
export interface RunAction {
    readonly server: string;
    readonly tool: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly ok: boolean;
}

export interface RunSummary {
    readonly prompt: string;
    readonly actions: readonly RunAction[];
    /** Files the agent edited in the run. */
    readonly edits: readonly string[];
}
