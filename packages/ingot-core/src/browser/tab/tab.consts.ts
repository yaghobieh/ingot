export const TAB_COMMANDS = {
    toggle: { id: 'ingot.tab.toggle', label: 'Toggle Tab Completions', category: 'Ingot' },
    jumpToNextEdit: { id: 'ingot.tab.jumpToNextEdit', label: 'Tab: Jump to Next Edit', category: 'Ingot' },
    dismissNextEdit: { id: 'ingot.tab.dismissNextEdit', label: 'Tab: Dismiss Next Edit Hint', category: 'Ingot' },
    /** Run by an accepted completion; not meant for Find Action. */
    showNextEdit: { id: 'ingot.tab.showNextEdit' },
    /** Run by an accepted completion (afterTabFileEdit hook, next-edit hint); not meant for Find Action. */
    accepted: { id: 'ingot.tab.accepted' }
} as const;

/** True while a next-edit hint is shown in the focused editor. */
export const TAB_NEXT_EDIT_KEY = 'ingotTabNextEdit';
const TAB_KEY_WHEN = `${TAB_NEXT_EDIT_KEY} && editorTextFocus && !inlineSuggestionVisible && !suggestWidgetVisible`;

/** Tab accepts ghost text and Esc hides it (Monaco defaults); these add the next-edit jump. */
export const TAB_KEYBINDINGS = [
    { command: TAB_COMMANDS.jumpToNextEdit.id, keybinding: 'tab', when: TAB_KEY_WHEN },
    { command: TAB_COMMANDS.dismissNextEdit.id, keybinding: 'escape', when: TAB_KEY_WHEN },
    { command: 'editor.action.inlineSuggest.acceptNextWord', keybinding: 'ctrlcmd+right', when: 'inlineSuggestionVisible && editorTextFocus' }
] as const;

export const TAB_STATUS_ID = 'ingot-tab-status';
export const TAB_STATUS_PRIORITY = 50;
export const TAB_STATUS_TEXT = { on: '$(sparkle) Tab', off: '$(sparkle) Tab off', capped: '$(sparkle) Tab (limit)' } as const;

export const TAB_TARGET_LINE_CLASS = 'ingot-tab-next-line';
export const TAB_HINT_CLASS = 'ingot-tab-next-hint';
export const TAB_TARGET_HINT = '  ⇥ Tab to jump here';
export const tabCursorHint = (line: number): string => `  ⇥ Tab: next edit at line ${line}`;

export const INLINE_SUGGEST_TRIGGER = 'editor.action.inlineSuggest.trigger';
export const TAB_TRIGGER_SOURCE = 'ingot.tab';
