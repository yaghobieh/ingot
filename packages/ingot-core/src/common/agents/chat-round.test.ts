import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentStep } from './agents.types';
import { conflictWarning, editConflicts, hasTurnActivity, stampThought, tabRunState, thoughtLabel, toggleReaction, turnActivity } from './chat-round';
import { REACTION_HEART, REACTION_LIKE } from './chat-round.consts';

const tool = (name: string, args: Record<string, unknown>, state: 'running' | 'done' | 'error' = 'done'): AgentMessage => ({
    role: 'tool', text: 'ok', tool: { server: 'ingot', tool: name, args, state, startedAt: 1 }
});

describe('chat round', () => {
    it('labels a live thought and a finished one', () => {
        expect(thoughtLabel(true)).toBe('Thinking…');
        expect(thoughtLabel(false)).toBe('Thought');
        expect(thoughtLabel(false, 1500)).toBe('Thought for 2s');
        expect(thoughtLabel(false, 0)).toBe('Thought for 1s');
    });

    it('stamps when a think block opens and closes', () => {
        const open = stampThought(undefined, '<think>plan it', 1_000);
        expect(open).toEqual({ thoughtStarted: 1_000 });
        expect(stampThought(open, '<think>plan it</think>Answer', 2_500)).toEqual({ thoughtStarted: 1_000, thoughtMs: 1_500 });
        expect(stampThought({ thoughtStarted: 1_000, thoughtMs: 1_500 }, '<think>plan it</think>Answer', 9_000).thoughtMs).toBe(1_500);
        expect(stampThought(undefined, 'plain', 1_000)).toEqual({});
    });

    it('toggles like and heart independently', () => {
        const liked = toggleReaction(undefined, REACTION_LIKE);
        expect(liked).toEqual([REACTION_LIKE]);
        expect(toggleReaction(liked, REACTION_HEART)).toEqual([REACTION_LIKE, REACTION_HEART]);
        expect(toggleReaction(liked, REACTION_LIKE)).toEqual([]);
    });

    it('summarises the latest turn only', () => {
        const steps: AgentStep[] = [
            { kind: 'edit', target: 'src/old.ts', done: true, added: 1, removed: 0 },
            { kind: 'edit', target: 'src/note.txt', done: true, added: 2, removed: 1 }
        ];
        const messages: AgentMessage[] = [
            { role: 'user', text: 'first' },
            tool('run', { command: 'npm test' }),
            { role: 'user', text: 'second' },
            tool('run', { command: 'node note.js' }),
            tool('git', { op: 'commit', message: 'Add the note\n\nbody' }),
            tool('ask_user', { question: 'Which name?' })
        ];
        const activity = turnActivity(messages, steps);
        expect(activity.commands).toEqual([{ command: 'node note.js', messageIndex: 3 }]);
        expect(activity.commits).toEqual([{ subject: 'Add the note', messageIndex: 4 }]);
        expect(activity.files.map(file => file.path)).toEqual(['src/old.ts', 'src/note.txt']);
        expect(hasTurnActivity(activity)).toBe(true);
        expect(hasTurnActivity(turnActivity([], []))).toBe(false);
    });

    it('finds files two sessions both edit', () => {
        expect(editConflicts([
            { id: 'a', paths: ['src/note.txt', 'src/other.ts'] },
            { id: 'b', paths: ['src/note.txt'] }
        ])).toEqual([{ path: 'src/note.txt', ids: ['a', 'b'] }]);
        expect(conflictWarning(['Beta'], 'src/note.txt')).toBe('Conflict: Beta also changed src/note.txt.');
    });

    it('reports tab state for a running, waiting and finished chat', () => {
        expect(tabRunState(true, false, true, 'thinking')).toBe('running');
        expect(tabRunState(true, true, true, 'thinking')).toBe('waiting');
        expect(tabRunState(false, false, true, 'idle')).toBe('done');
        expect(tabRunState(false, false, false, 'idle')).toBe('idle');
    });
});
