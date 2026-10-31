/**
 * IDEA-280: messages typed while a run is going, per chat. They show a "Queued" chip until the next model round
 * reads them. Items are compared by identity, so the same text sent twice is two entries.
 */
export class SteerQueue<T> {

    protected readonly items = new Map<string, T[]>();

    add(sessionId: string, item: T): void {
        this.items.set(sessionId, [...(this.items.get(sessionId) ?? []), item]);
    }

    has(sessionId: string, item: T): boolean {
        return !!this.items.get(sessionId)?.includes(item);
    }

    size(sessionId: string): number {
        return this.items.get(sessionId)?.length ?? 0;
    }

    /** Empties the chat's queue and returns what was in it, oldest first. */
    take(sessionId: string): T[] {
        const taken = this.items.get(sessionId) ?? [];
        this.items.delete(sessionId);
        return taken;
    }
}
