/** Theia throws this from SocketWriteBuffer.ensureWriteBuffer when a closed client is still notified. */
export const DISCONNECTED_BUFFER_ERROR = 'Max disconnected buffer size exceeded';

export const isDisconnectedBufferError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return message.startsWith(DISCONNECTED_BUFFER_ERROR);
};

const drops = new Set<() => void>();

/** A backend service registers this so it can drop client proxies that no longer accept notifications. */
export const registerClientDrop = (drop: () => void): void => {
    drops.add(drop);
};

export const dropDisconnectedClients = (): void => {
    for (const drop of drops) {
        try {
            drop();
        } catch {
            drops.delete(drop);
        }
    }
};
