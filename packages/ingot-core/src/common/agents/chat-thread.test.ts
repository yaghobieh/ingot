import { describe, expect, it } from 'vitest';
import { distanceFromBottom, latestUserIndex, scrollTopAfterUpdate, showJumpToLatest, truncateForEdit, userJumpTargets } from './chat-thread';
import { JUMP_FROM_BOTTOM_PX } from './chat-thread.consts';

describe('chat thread', () => {
    const messages = [
        { role: 'user', text: 'explain the picker' },
        { role: 'agent', text: 'it ranks files' },
        { role: 'user', text: 'hidden nudge', hidden: true },
        { role: 'user', text: 'add a unit test for rankFiles and run it' }
    ];

    it('shows jump to latest only after the user scrolls up', () => {
        expect(distanceFromBottom(0, 400, 100)).toBe(300);
        expect(showJumpToLatest(JUMP_FROM_BOTTOM_PX)).toBe(false);
        expect(showJumpToLatest(JUMP_FROM_BOTTOM_PX + 1)).toBe(true);
        expect(distanceFromBottom(350, 400, 100)).toBe(0);
    });

    it('follows the bottom only when the reader is already there', () => {
        expect(scrollTopAfterUpdate(40, 1000, 200, false)).toBe(40);
        expect(scrollTopAfterUpdate(800, 1200, 200, true)).toBe(1000);
        expect(scrollTopAfterUpdate(0, 50, 200, true)).toBe(0);
    });

    it('marks the latest visible user message and lists earlier ones', () => {
        expect(latestUserIndex(messages)).toBe(3);
        expect(userJumpTargets(messages).map(target => target.index)).toEqual([0, 3]);
        expect(userJumpTargets(messages)[1].label).toContain('add a unit test');
    });

    it('drops the edited message and every turn after it', () => {
        expect(truncateForEdit(messages, 3)).toHaveLength(3);
        expect(truncateForEdit(messages, 0)).toEqual([]);
        expect(truncateForEdit(messages, -1)).toHaveLength(messages.length);
    });
});
