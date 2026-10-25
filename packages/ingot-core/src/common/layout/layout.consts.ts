import type { ChatPosition } from './layout.types';

export const LAYOUT_PREFS = {
    chatPosition: 'ingot.layout.chatPosition'
} as const;

export const CHAT_POSITIONS: readonly ChatPosition[] = ['right', 'bottom'];
export const DEFAULT_CHAT_POSITION: ChatPosition = 'right';
