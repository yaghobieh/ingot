import { describe, expect, it } from 'vitest';
import { SocketWriteBuffer } from '@theia/core/lib/common/messaging/socket-write-buffer';
import { installDisconnectedBufferGuard } from './disconnected-client-guard';

const LIMIT_BYTES = 100 * 1024;
const CHUNK_BYTES = 60 * 1024;

describe('disconnected write buffer', () => {
    it('drops writes after the buffer overflows and still flushes a connected buffer', () => {
        installDisconnectedBufferGuard();
        const flooded = new SocketWriteBuffer();
        const chunk = new Uint8Array(CHUNK_BYTES);
        expect(CHUNK_BYTES * 2).toBeGreaterThan(LIMIT_BYTES);
        flooded.buffer(chunk);
        expect(() => flooded.buffer(chunk)).not.toThrow();
        expect(() => flooded.buffer(new Uint8Array([1]))).not.toThrow();
        let floodedBytes = 0;
        flooded.flush({ send: (data: Uint8Array) => { floodedBytes += data.byteLength; } } as never);
        expect(floodedBytes).toBe(0);
        flooded.buffer(new Uint8Array([7, 8]));
        flooded.flush({ send: (data: Uint8Array) => { floodedBytes += data.byteLength; } } as never);
        expect(floodedBytes).toBe(2);

        const healthy = new SocketWriteBuffer();
        healthy.buffer(new Uint8Array([4, 5, 6]));
        let healthyBytes = 0;
        healthy.flush({ send: (data: Uint8Array) => { healthyBytes = data.byteLength; } } as never);
        expect(healthyBytes).toBe(3);
    });
});
