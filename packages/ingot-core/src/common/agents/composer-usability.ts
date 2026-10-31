import { DEAD_KEY, PINNED_SLACK_PX } from './composer-usability.consts';
import type { EditRerunChoice, EditRerunPlan, KeyStroke, PromptClickAction } from './composer-usability.types';

/** The unshifted character of a letter or digit key (`KeyC` → `c`, `Digit7` → `7`). */
const baseCharacter = (code: string): string | undefined => /^(?:Key|Digit)(\w)$/.exec(code)?.[1].toLowerCase();

/**
 * IDEA-280: true when a keystroke types a character into a text field rather than running a shortcut.
 * Workbench keybindings match physical keys, so without this Option combos (macOS: `\` `|` `~` `[` on European
 * layouts) and AltGr combos (Windows / Linux, reported as Ctrl+Alt) were taken as shortcuts and never typed.
 * Cmd shortcuts always stay shortcuts; so does Ctrl+Alt+<letter or digit> when it yields that same letter or digit.
 */
export const typesCharacter = (e: KeyStroke, mac: boolean): boolean => {
    if (e.metaKey || !(e.key.length === 1 || e.key === DEAD_KEY)) {
        return false;
    }
    if (!e.ctrlKey) {
        return mac || !e.altKey;
    }
    if (mac || !e.altKey) {
        return false;
    }
    const base = baseCharacter(e.code);
    return base === undefined || e.key.toLowerCase() !== base;
};

/** IDEA-280: what each edit choice does. Cancel neither reverts nor reruns. */
export const editRerunPlan = (choice: EditRerunChoice): EditRerunPlan => ({
    rerun: choice !== 'cancel',
    revert: choice === 'revert'
});

/**
 * A click on a sent prompt: the pinned latest prompt, while scrolled away from its place, scrolls back first;
 * otherwise the click opens the inline edit. Clicks while editing, on controls, or ending a text selection do nothing.
 */
export const promptClickAction = (opts: {
    readonly editing: boolean;
    readonly onControl: boolean;
    readonly selecting: boolean;
    readonly latest: boolean;
    /** scrollTop of the thread minus the prompt's in-flow top; > 0 means it is stuck to the top. */
    readonly pinnedOffset: number;
}): PromptClickAction => {
    if (opts.editing || opts.onControl || opts.selecting) {
        return 'none';
    }
    return opts.latest && opts.pinnedOffset > PINNED_SLACK_PX ? 'reveal' : 'edit';
};
