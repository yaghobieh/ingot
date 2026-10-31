import * as React from '@theia/core/shared/react';
import { HABIT_NOTE_ICONS, HABIT_NOTE_TEXT } from '../../common/habits/learned.consts';
import type { HabitNoteInfo } from '../../common/habits/learned.types';

export interface HabitNoteProps {
    readonly note: HabitNoteInfo;
    readonly id?: string;
    /** The note's action button ("Use original", "Open brief"). */
    readonly onAction?: () => void;
}

/** IDEA-305/306/307: the small silver inline note in the agent chat when something is saved or decided (Habits style). */
export const HabitNote = ({ note, id, onAction }: HabitNoteProps): React.ReactElement =>
    <div id={id} className={`ingot-habit-note ingot-habit-note-${note.kind}`} data-kind={note.kind} role='status'>
        <span className={`codicon codicon-${HABIT_NOTE_ICONS[note.kind]}`} aria-hidden='true' />
        <span className='ingot-habit-note-text'>{HABIT_NOTE_TEXT[note.kind]}</span>
        {note.detail && <span className='ingot-habit-note-detail' title={note.detail}>· {note.detail}</span>}
        {note.action && note.actionLabel && !note.done && onAction && <button type='button' className='ingot-habit-note-action' onClick={onAction}>{note.actionLabel}</button>}
    </div>;
