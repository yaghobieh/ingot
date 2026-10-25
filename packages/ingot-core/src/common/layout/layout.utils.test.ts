import { describe, expect, it } from 'vitest';
import { toChatPosition } from './layout.utils';

describe('layout (IDEA-85)', () => {
    it('reads the chat position with a right-side default', () => {
        expect(toChatPosition('bottom')).toBe('bottom');
        expect(toChatPosition('right')).toBe('right');
        expect(toChatPosition('top')).toBe('right');
        expect(toChatPosition(undefined)).toBe('right');
    });
});
