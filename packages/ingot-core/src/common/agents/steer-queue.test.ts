import { describe, expect, it } from 'vitest';
import { SteerQueue } from './steer-queue';

describe('SteerQueue (IDEA-280)', () => {
    it('marks messages per chat by identity until taken', () => {
        const queue = new SteerQueue<{ text: string }>();
        const first = { text: 'also add tests' };
        const twin = { text: 'also add tests' };
        queue.add('a', first);
        expect(queue.has('a', first)).toBe(true);
        expect(queue.has('a', twin)).toBe(false);
        expect(queue.has('b', first)).toBe(false);
        expect(queue.size('a')).toBe(1);
    });

    it('take returns the queue oldest first and empties it', () => {
        const queue = new SteerQueue<string>();
        queue.add('a', 'one');
        queue.add('a', 'two');
        queue.add('b', 'other');
        expect(queue.take('a')).toEqual(['one', 'two']);
        expect(queue.size('a')).toBe(0);
        expect(queue.take('a')).toEqual([]);
        expect(queue.has('b', 'other')).toBe(true);
    });
});
