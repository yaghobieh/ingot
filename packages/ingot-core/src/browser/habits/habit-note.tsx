import * as React from '@theia/core/shared/react';
import { HABIT_NOTE_ICONS, HABIT_NOTE_LABELS, HABIT_NOTE_TEXT, HABIT_NOTE_UNDONE_ICON } from '../../common/habits/habits.consts';
import type { HabitNoteInfo } from '../../common/habits/habits.types';

export interface HabitNoteProps {
    readonly note: HabitNoteInfo;
    readonly id?: string;
    /** Opens the habit on the Habits page; the note text is a button while the note is not undone. */
    readonly onOpen?: () => void;
    /** Undo label ("Undo", "Unlock", "Unfreeze"); the link shows while the note is not undone. */
    readonly undoLabel?: string;
    readonly onUndo?: () => void;
}

/**
 * The one small silver note in the agent chat when something is saved or decided: "Saved to Habits" (IDEA-296),
 * "Locked in Decisions", "Frozen" (IDEA-302..304). Opens the habit on the Habits page, with Undo.
 */
export const HabitNote = ({ note, id, onOpen, undoLabel, onUndo }: HabitNoteProps): React.ReactElement => {
    const removed = note.undone && note.kind === 'habit';
    const text = removed ? HABIT_NOTE_LABELS.undone : note.text ?? HABIT_NOTE_TEXT[note.kind];
    const body = <>
        <span className={`codicon codicon-${removed ? HABIT_NOTE_UNDONE_ICON : HABIT_NOTE_ICONS[note.kind]}`} aria-hidden='true' />
        <span className='ingot-habit-note-text'>{text}</span>
        {note.detail && <span className='ingot-habit-note-detail'>{note.detail}</span>}
    </>;
    const title = note.detail ? `${text}: ${note.detail}` : text;
    return <div id={id} className={`ingot-habit-note ingot-habit-note-${note.kind}${note.undone ? ' undone' : ''}`} data-note-kind={note.kind}
        data-habit-note={note.focus} role='status'>
        {onOpen && !note.undone
            ? <button type='button' className='ingot-habit-note-open' title={`${HABIT_NOTE_LABELS.open}: ${note.detail ?? text}`} onClick={onOpen}>{body}</button>
            : <span className='ingot-habit-note-open' title={title}>{body}</span>}
        {undoLabel && onUndo && !note.undone && <button type='button' className='ingot-habit-note-undo' onClick={onUndo}>{undoLabel}</button>}
    </div>;
};
