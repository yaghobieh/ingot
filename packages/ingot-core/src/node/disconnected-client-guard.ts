import { SocketWriteBuffer } from '@theia/core/lib/common/messaging/socket-write-buffer';
import type { WebSocket } from '@theia/core/lib/common/messaging/web-socket-channel';
import { isDisconnectedBufferError } from '../common/rpc/disconnected-client';

const dropping = new WeakSet<SocketWriteBuffer>();
let installed = false;

/**
 * A disconnected front end used to keep receiving notifications until Theia's 100KB write buffer threw
 * `Max disconnected buffer size exceeded` on every further send. Once a buffer overflows, later writes
 * to that buffer are dropped until the socket reconnects and flushes. Other clients stay registered:
 * one closed page must not silence a live session. Live sockets never use this buffer, so a connected
 * agent's requests and stream polls are unchanged.
 */
export const installDisconnectedBufferGuard = (): void => {
    if (installed) {
        return;
    }
    installed = true;
    const proto = SocketWriteBuffer.prototype;
    const originalBuffer = proto.buffer;
    const originalFlush = proto.flush;
    const originalDrain = proto.drain;
    proto.buffer = function buffer(this: SocketWriteBuffer, data: Uint8Array): void {
        if (dropping.has(this)) {
            return;
        }
        try {
            originalBuffer.call(this, data);
        } catch (error) {
            if (!isDisconnectedBufferError(error)) {
                throw error;
            }
            this.drain();
            dropping.add(this);
        }
    };
    proto.flush = function flush(this: SocketWriteBuffer, socket: WebSocket): void {
        dropping.delete(this);
        originalFlush.call(this, socket);
    };
    proto.drain = function drain(this: SocketWriteBuffer): void {
        dropping.delete(this);
        originalDrain.call(this);
    };
};
