import * as React from '@theia/core/shared/react';
import type { HabitNoteInfo, HabitNoteKind } from '../../common/habits/habits.types';

const ICONS: Readonly<Record<HabitNoteKind, string>> = { decision: 'lock', frozen: 'snowflake', habit: 'checklist' };

export interface HabitNoteProps {
    readonly note: HabitNoteInfo;
    /** Undo label ("Unlock", "Unfreeze"); the link shows while the note is not undone. */
    readonly undoLabel?: string;
    readonly onUndo?: () => void;
    readonly id?: string;
}

/**
 * IDEA-302..304: the small silver inline note in the agent chat when something is saved: "Locked in Decisions",
 * "Frozen", "Saved to Habits". Shared by Decisions, Frozen Zones, the Doom-Loop Breaker and Habits.
 */
export const HabitNote = ({ note, undoLabel, onUndo, id }: HabitNoteProps): React.ReactElement =>
    <div id={id} className={`ingot-habit-note${note.undone ? ' undone' : ''}`} data-note-kind={note.kind} role='status' title={note.detail ? `${note.text}: ${note.detail}` : note.text}>
        <span className={`codicon codicon-${ICONS[note.kind]}`} aria-hidden='true' />
        <span className='ingot-habit-note-text'>{note.text}</span>
        {note.detail && <span className='ingot-habit-note-detail'>· {note.detail}</span>}
        {undoLabel && onUndo && !note.undone && <button type='button' className='ingot-habit-note-undo' onClick={onUndo}>{undoLabel}</button>}
    </div>;
