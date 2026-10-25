import type { Command } from '@theia/core/lib/common/command';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';

export const LAYOUT_COMMANDS = {
    chatRight: { id: 'ingot.layout.chatRight', label: 'Chat on the Right', category: 'View' },
    chatBottom: { id: 'ingot.layout.chatBottom', label: 'Chat at the Bottom', category: 'View' }
} as const satisfies Record<string, Command>;

/** Right-click menu on the chat header and the stripe's Agents button. */
export const LAYOUT_CONTEXT_MENU = ['ingot-layout-context'];
/** View > Layout submenu. */
export const VIEW_LAYOUT_MENU = [...CommonMenus.VIEW, '0_ingot_layout'];
export const VIEW_LAYOUT_LABEL = 'Layout';
