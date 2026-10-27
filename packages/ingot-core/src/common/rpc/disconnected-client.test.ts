import { describe, expect, it } from 'vitest';
import { dropDisconnectedClients, isDisconnectedBufferError, registerClientDrop } from './disconnected-client';

describe('disconnected client notifications', () => {
    it('recognises the write-buffer overflow from either wording', () => {
        expect(isDisconnectedBufferError(new Error('Max disconnected buffer size exceeded'))).toBe(true);
        expect(isDisconnectedBufferError(new Error('Max disconnected buffer size exceeded by adding 40 bytes'))).toBe(true);
        expect(isDisconnectedBufferError(new Error('socket hang up'))).toBe(false);
    });

    it('runs every registered drop once the buffer gives up', () => {
        let cleared = 0;
        registerClientDrop(() => { cleared += 1; });
        dropDisconnectedClients();
        expect(cleared).toBe(1);
    });
});
