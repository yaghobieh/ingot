import * as React from '@theia/core/shared/react';
import { HABIT_NOTE_LABELS } from '../../common/habits/habits.consts';
import type { HabitNote } from '../../common/habits/habits.types';
import { habitNoteDetail } from '../../common/habits/habits.utils';

export interface HabitNoteLineProps {
    readonly note: HabitNote;
    readonly onOpen: () => void;
    readonly onUndo: () => void;
}

/** IDEA-296: the small silver "Saved to Habits · …" line in the chat; opens the habit on the Habits page, with Undo. */
export const HabitNoteLine = ({ note, onOpen, onUndo }: HabitNoteLineProps): React.ReactElement => {
    const detail = habitNoteDetail(note);
    return <div className={`ingot-habit-note${note.undone ? ' undone' : ''}`} role='status' data-habit-note={note.focus}>
        {note.undone
            ? <span className='ingot-habit-note-open'>
                <span className='codicon codicon-discard' aria-hidden='true' />
                <span className='ingot-habit-note-label'>{HABIT_NOTE_LABELS.undone}</span>
                <span className='ingot-habit-note-detail'>{detail}</span>
            </span>
            : <button type='button' className='ingot-habit-note-open' title={`${HABIT_NOTE_LABELS.open}: ${detail}`} onClick={onOpen}>
                <span className='codicon codicon-checklist' aria-hidden='true' />
                <span className='ingot-habit-note-label'>{HABIT_NOTE_LABELS.saved}</span>
                <span className='ingot-habit-note-detail'>{detail}</span>
            </button>}
        {!note.undone && <button type='button' className='ingot-habit-note-undo' onClick={onUndo}>{HABIT_NOTE_LABELS.undo}</button>}
    </div>;
};
