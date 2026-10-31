import type { EditRerunChoice } from './composer-usability.types';

/** IDEA-280: the three choices shown after editing a sent prompt, in display order. */
export const EDIT_RERUN_CHOICES: readonly { readonly id: EditRerunChoice; readonly label: string; readonly title: string }[] = [
    { id: 'revert', label: 'Revert changes after this point and rerun', title: 'Restore files to before this message, drop the replies after it, then run the edited prompt' },
    { id: 'keep', label: 'Keep changes and rerun', title: 'Keep the files as they are now, drop the replies after this message, then run the edited prompt' },
    { id: 'cancel', label: 'Cancel', title: 'Keep editing' }
];

export const QUEUED_LABEL = 'Queued';
export const QUEUED_TITLE = 'Sent to the running agent. It reads this on its next step.';
export const EDIT_PROMPT_TITLE = 'Click to edit this message and run again from here';

/** How far (px) the pinned latest prompt may sit from its place in the thread and still count as "in place". */
export const PINNED_SLACK_PX = 4;

/** KeyboardEvent.key of a dead key (` ´ ~ ^ on many layouts start a composed character). */
export const DEAD_KEY = 'Dead';

/** Text fields the key guard protects. */
export const TEXT_FIELD_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"]';

/** Clicks on these keep their own action instead of opening the inline edit. */
export const PROMPT_CLICK_IGNORE = 'button, input, textarea, a, .ingot-chip, form';
