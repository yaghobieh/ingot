import { CHAT_POSITIONS, DEFAULT_CHAT_POSITION } from './layout.consts';
import type { ChatPosition } from './layout.types';

/** A stored chat position, falling back to the default for anything unknown. */
export const toChatPosition = (value: unknown): ChatPosition =>
    CHAT_POSITIONS.includes(value as ChatPosition) ? value as ChatPosition : DEFAULT_CHAT_POSITION;
