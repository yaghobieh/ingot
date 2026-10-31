import { AT_BOTTOM_PX, JUMP_FROM_BOTTOM_PX, USER_JUMP_LABEL_CHARS } from './chat-thread.consts';
import type { JumpTarget } from './chat-thread.types';

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

/** The reader is at the bottom of the thread (a pixel or two of rounding still counts). */
export const isAtBottom = (distance: number): boolean => distance <= AT_BOTTOM_PX;

/**
 * Whether the thread keeps following new content after a scroll event. Reaching the bottom starts following;
 * only a move up stops it. Scrolls made by following, a smooth jump down or content growing underneath never do.
 */
export const followAfterScroll = (following: boolean, scrollTop: number, lastTop: number, distance: number): boolean =>
    isAtBottom(distance) || (following && scrollTop >= lastTop - AT_BOTTOM_PX);

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
