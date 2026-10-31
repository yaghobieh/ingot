import { Command } from '@theia/core/lib/common/command';

/** IDEA-130 / IDEA-289: Browser panel commands (Find Action lists the labelled ones). */
export const BROWSER_COMMANDS = {
    open: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.open', category: 'Browser', label: 'Open Browser' }),
    toggleControl: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.toggleControl', category: 'Browser', label: 'Take / Give Back Browser Control' }),
    openExternal: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.openExternal', category: 'Browser', label: 'Open Page in External Browser' }),
    quoteSelection: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.quoteSelection', category: 'Browser', label: 'Quote Page Selection in Agent Chat' }),
    commentSelection: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.commentSelection', category: 'Browser', label: 'Comment on Page Selection in Agent Chat' }),
    /** The comment box's Send (not in Find Action: it needs the typed comment). */
    sendComment: { id: 'ingot.browser.sendComment' }
};

/** Ctrl / Cmd chords the page keeps (select all, copy, paste, cut, undo, redo); others are replayed for Ingot's shortcuts. */
export const PAGE_NATIVE_KEY_CODES: readonly string[] = ['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY'];

/** Heights the selection bar is placed with (plain bar, and with the comment box open). */
export const SELECTION_BAR_HEIGHT_PX = 34;
export const COMMENT_BAR_HEIGHT_PX = 96;
