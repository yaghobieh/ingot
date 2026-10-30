import { AT_BOTTOM_PX, JUMP_FROM_BOTTOM_PX, USER_JUMP_LABEL_CHARS } from './chat-thread.consts';
import type { JumpTarget, ThreadFollow, ThreadScroll } from './chat-thread.types';

export interface ThreadMessage {
    readonly role: string;
    readonly text: string;
    readonly hidden?: boolean;
}

/** Pixels between the scroll position and the bottom of the thread. */
export const distanceFromBottom = (scrollTop: number, scrollHeight: number, clientHeight: number): number =>
    Math.max(0, scrollHeight - clientHeight - scrollTop);

/** True when the user has scrolled up far enough that the latest turn may be off screen. */
export const showJumpToLatest = (distance: number): boolean => distance > JUMP_FROM_BOTTOM_PX;

/**
 * Follow state after a scroll event. Any move up away from the bottom stops following at once, so a small wheel
 * step is never yanked back by the next streamed token; reaching the bottom again resumes following. Text streaming in
 * grows scrollHeight without moving scrollTop, and a shrinking thread clamps the reader to the bottom, so neither
 * stops following on its own.
 */
export const followAfterScroll = (scroll: ThreadScroll, stick: boolean): ThreadFollow => {
    const atBottom = distanceFromBottom(scroll.top, scroll.scrollHeight, scroll.clientHeight) <= AT_BOTTOM_PX;
    const next = atBottom || (stick && scroll.top >= scroll.previousTop);
    return { stick: next, showJump: !next };
};

/**
 * Where the thread should sit after new text or a panel under it changes size.
 * Follow the latest line only when the reader is already at the bottom; otherwise leave scrollTop alone.
 */
export const scrollTopAfterUpdate = (scrollTop: number, scrollHeight: number, clientHeight: number, follow: boolean): number =>
    follow ? Math.max(0, scrollHeight - clientHeight) : scrollTop;

/** The latest user message the person typed. Hidden nudges do not count. */
export const latestUserIndex = (messages: readonly Pick<ThreadMessage, 'role' | 'hidden'>[]): number => {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index].role === 'user' && !messages[index].hidden) {
            return index;
        }
    }
    return -1;
};

const jumpLabel = (text: string): string => {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > USER_JUMP_LABEL_CHARS ? `${line.slice(0, USER_JUMP_LABEL_CHARS - 1)}…` : line;
};

/** Earlier user messages, oldest first, so the thread can jump back to one. */
export const userJumpTargets = (messages: readonly ThreadMessage[]): JumpTarget[] =>
    messages.flatMap((message, index) => message.role === 'user' && !message.hidden ? [{ index, label: jumpLabel(message.text) }] : []);

/** Messages kept when a sent user message is edited. The message itself and everything after it are dropped. */
export const truncateForEdit = <T>(messages: readonly T[], index: number): T[] =>
    index < 0 ? [...messages] : messages.slice(0, index);
