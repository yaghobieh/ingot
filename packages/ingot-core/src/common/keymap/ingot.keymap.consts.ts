import type { KeymapEntry } from './keymap.types';
import { CHANGES_PENDING_KEY } from '../changes/changes.consts';
import { TEST_COMMAND_IDS } from '../testing/testing.consts';
import { INLINE_EDIT_COMMANDS } from '../inline-edit/inline-edit.consts';
import { LOCAL_HISTORY_COMMANDS } from '../local-history/local-history.consts';
import { INDEX_COMMANDS } from '../codebase-index/codebase-index.consts';

/** Ingot commands the Ingot keymap points at (implemented in the browser keymap / run contributions). */
export const INGOT_NAV_COMMANDS = {
    searchEverywhere: { id: 'ingot.searchEverywhere', label: 'Search Everywhere', category: 'Navigate' },
    recentFiles: { id: 'ingot.recentFiles', label: 'Recent Files', category: 'Navigate' },
    recentLocations: { id: 'ingot.recentLocations', label: 'Recent Locations', category: 'Navigate' },
    goToClass: { id: 'ingot.goToClass', label: 'Go to Class', category: 'Navigate' },
    goToSymbol: { id: 'ingot.goToSymbol', label: 'Go to Symbol', category: 'Navigate' }
} as const;

export const INGOT_RUN_COMMANDS = {
    run: { id: 'ingot.run', label: 'Run', category: 'Run' },
    debug: { id: 'ingot.debug', label: 'Debug', category: 'Run' },
    stop: { id: 'ingot.stop', label: 'Stop', category: 'Run' }
} as const;

/** Keeps Ingot shortcuts from stealing the agent review keys (Ctrl+Y / Ctrl+N, ⌥↑ / ⌥↓) while changes wait. */
const NOT_REVIEWING = `!${CHANGES_PENDING_KEY}`;
const EDITOR = 'editorTextFocus';
/** A debug session is running. */
const IN_DEBUG = 'inDebugMode';
/** Focus is inside the Agents tool window (chat). */
const AGENTS_FOCUS = 'ingotAgentsFocus';
const EDITOR_NOT_REVIEWING = `${EDITOR} && ${NOT_REVIEWING}`;
/** Code is selected in the focused editor; Theia prefers this editor-local binding over a global one on the same key. */
const EDITOR_SELECTION = `${EDITOR} && editorHasSelection`;

/**
 * Ingot default keymap (IDEA-18): "macOS" and "Windows/Linux" variants.
 * Theia syntax: `ctrlcmd` = Cmd on macOS, `ctrl` = the real Control key, `alt` = Option.
 */
export const INGOT_KEYMAP: readonly KeymapEntry[] = [
    // Navigation (IDEA-19/20)
    { action: 'Go to File', command: 'file-search.openFile', mac: 'ctrlcmd+shift+o', other: 'ctrl+shift+n' },
    { action: 'Go to Class', command: INGOT_NAV_COMMANDS.goToClass.id, mac: 'ctrlcmd+o', other: 'ctrl+n', when: NOT_REVIEWING },
    { action: 'Go to Symbol', command: INGOT_NAV_COMMANDS.goToSymbol.id, mac: 'ctrlcmd+alt+o', other: 'ctrl+alt+shift+n' },
    { action: 'Go to Line:Column', command: 'editor.action.gotoLine', mac: 'ctrlcmd+l', other: 'ctrl+g', when: EDITOR },
    { action: 'Find Action', command: 'workbench.action.showCommands', mac: 'ctrlcmd+shift+a', other: 'ctrl+shift+a' },
    { action: 'Recent Files', command: INGOT_NAV_COMMANDS.recentFiles.id, mac: 'ctrlcmd+e', other: 'ctrl+e' },
    { action: 'Recent Locations', command: INGOT_NAV_COMMANDS.recentLocations.id, mac: 'ctrlcmd+shift+e', other: 'ctrl+shift+e' },
    { action: 'File Structure', command: 'editor.action.quickOutline', mac: 'ctrlcmd+f12', other: 'ctrl+f12', when: EDITOR },
    { action: 'Back', command: 'textEditor.commands.go.back', mac: 'ctrlcmd+[', other: 'ctrl+alt+left' },
    { action: 'Forward', command: 'textEditor.commands.go.forward', mac: 'ctrlcmd+]', other: 'ctrl+alt+right' },
    { action: 'Declaration or Usages', command: 'editor.action.revealDefinition', mac: 'ctrlcmd+b', other: 'ctrl+b', when: EDITOR },
    { action: 'Implementation(s)', command: 'editor.action.goToImplementation', mac: 'ctrlcmd+alt+b', other: 'ctrl+alt+b', when: EDITOR },
    { action: 'Find Usages', command: 'editor.action.goToReferences', mac: 'alt+f7', other: 'alt+f7', when: EDITOR },
    { action: 'Show Usages', command: 'editor.action.referenceSearch.trigger', mac: 'ctrlcmd+alt+f7', other: 'ctrl+alt+f7', when: EDITOR },
    { action: 'Next Highlighted Error', command: 'editor.action.marker.nextInFiles', mac: 'f2', other: 'f2', when: EDITOR },
    { action: 'Previous Highlighted Error', command: 'editor.action.marker.prevInFiles', mac: 'shift+f2', other: 'shift+f2', when: EDITOR },
    // Tabs (IDEA-17)
    { action: 'Close Tab', command: 'core.close.tab', mac: 'ctrlcmd+w', other: 'ctrl+f4' },
    { action: 'Select Next Tab', command: 'core.nextTab', mac: 'ctrlcmd+shift+]', other: 'alt+right' },
    { action: 'Select Previous Tab', command: 'core.previousTab', mac: 'ctrlcmd+shift+[', other: 'alt+left' },
    // Find / replace (IDEA-21/22)
    { action: 'Find', command: 'actions.find', mac: 'ctrlcmd+f', other: 'ctrl+f', when: EDITOR },
    { action: 'Replace', command: 'editor.action.startFindReplaceAction', mac: 'ctrlcmd+r', other: 'ctrl+r', when: EDITOR },
    { action: 'Find Next', command: 'editor.action.nextMatchFindAction', mac: 'ctrlcmd+g', other: 'f3', when: EDITOR },
    { action: 'Find Previous', command: 'editor.action.previousMatchFindAction', mac: 'ctrlcmd+shift+g', other: 'shift+f3', when: EDITOR },
    { action: 'Find in Files', command: 'search-in-workspace.open', mac: 'ctrlcmd+shift+f', other: 'ctrl+shift+f' },
    { action: 'Replace in Files', command: 'search-in-workspace.replace', mac: 'ctrlcmd+shift+r', other: 'ctrl+shift+r' },
    // Editing
    { action: 'Duplicate Line or Selection', command: 'editor.action.duplicateSelection', mac: 'ctrlcmd+d', other: 'ctrl+d', when: EDITOR },
    { action: 'Delete Line', command: 'editor.action.deleteLines', mac: 'ctrlcmd+backspace', other: 'ctrl+y', when: EDITOR_NOT_REVIEWING },
    { action: 'Comment with Line Comment', command: 'editor.action.commentLine', mac: 'ctrlcmd+/', other: 'ctrl+/', when: EDITOR },
    { action: 'Comment with Block Comment', command: 'editor.action.blockComment', mac: 'ctrlcmd+alt+/', other: 'ctrl+shift+/', when: EDITOR },
    { action: 'Move Line Up', command: 'editor.action.moveLinesUpAction', mac: 'alt+shift+up', other: 'alt+shift+up', when: EDITOR },
    { action: 'Move Line Down', command: 'editor.action.moveLinesDownAction', mac: 'alt+shift+down', other: 'alt+shift+down', when: EDITOR },
    { action: 'Move Statement Up', command: 'editor.action.moveLinesUpAction', mac: 'ctrlcmd+shift+up', other: 'ctrl+shift+up', when: EDITOR },
    { action: 'Move Statement Down', command: 'editor.action.moveLinesDownAction', mac: 'ctrlcmd+shift+down', other: 'ctrl+shift+down', when: EDITOR },
    { action: 'Extend Selection', command: 'editor.action.smartSelect.expand', mac: 'alt+up', other: 'ctrl+w', when: EDITOR_NOT_REVIEWING },
    { action: 'Shrink Selection', command: 'editor.action.smartSelect.shrink', mac: 'alt+down', other: 'ctrl+shift+w', when: EDITOR_NOT_REVIEWING },
    { action: 'Add Selection for Next Occurrence', command: 'editor.action.addSelectionToNextFindMatch', mac: 'ctrl+g', other: 'alt+j', when: EDITOR },
    { action: 'Select All Occurrences', command: 'editor.action.selectHighlights', mac: 'ctrlcmd+ctrl+g', other: 'ctrl+alt+shift+j', when: EDITOR },
    { action: 'Join Lines', command: 'editor.action.joinLines', mac: 'ctrl+shift+j', other: 'ctrl+shift+j', when: EDITOR },
    { action: 'Start New Line', command: 'editor.action.insertLineAfter', mac: 'shift+enter', other: 'shift+enter', when: EDITOR },
    { action: 'Parameter Info', command: 'editor.action.triggerParameterHints', mac: 'ctrlcmd+p', other: 'ctrl+p', when: EDITOR },
    { action: 'Quick Documentation', command: 'editor.action.showHover', mac: 'f1', other: 'ctrl+q', when: EDITOR },
    { action: 'Show Context Actions', command: 'editor.action.quickFix', mac: 'alt+enter', other: 'alt+enter', when: EDITOR },
    { action: 'Collapse', command: 'editor.fold', mac: 'ctrlcmd+-', other: 'ctrl+-', when: EDITOR },
    { action: 'Expand', command: 'editor.unfold', mac: 'ctrlcmd+=', other: 'ctrl+=', when: EDITOR },
    { action: 'Collapse All', command: 'editor.foldAll', mac: 'ctrlcmd+shift+-', other: 'ctrl+shift+-', when: EDITOR },
    { action: 'Expand All', command: 'editor.unfoldAll', mac: 'ctrlcmd+shift+=', other: 'ctrl+shift+=', when: EDITOR },
    // Refactoring (IDEA-23)
    { action: 'Rename', command: 'editor.action.rename', mac: 'shift+f6', other: 'shift+f6', when: EDITOR },
    { action: 'Refactor This', command: 'editor.action.refactor', mac: 'ctrl+t', other: 'ctrl+alt+shift+t', when: EDITOR },
    { action: 'Reformat Code', command: 'editor.action.formatDocument', mac: 'ctrlcmd+alt+l', other: 'ctrl+alt+l', when: EDITOR },
    { action: 'Optimize Imports', command: 'editor.action.organizeImports', mac: 'ctrl+alt+o', other: 'ctrl+alt+o', when: EDITOR },
    // Run / debug (IDEA-24)
    { action: 'Run', command: INGOT_RUN_COMMANDS.run.id, mac: 'ctrl+r', other: 'shift+f10' },
    { action: 'Debug', command: INGOT_RUN_COMMANDS.debug.id, mac: 'ctrl+d', other: 'shift+f9' },
    { action: 'Stop', command: INGOT_RUN_COMMANDS.stop.id, mac: 'ctrlcmd+f2', other: 'ctrl+f2' },
    // Tests (IDEA-261)
    { action: 'Run All Tests', command: TEST_COMMAND_IDS.runAll, mac: 'ctrl+shift+r', other: 'ctrl+shift+f10' },
    { action: 'Rerun Failed Tests', command: TEST_COMMAND_IDS.rerunFailed, mac: 'ctrl+alt+shift+r', other: 'ctrl+alt+shift+f10' },
    // Debugger (IDEA-138)
    { action: 'Run/Debug Configurations', command: 'ingot.debug.selectConfiguration', mac: 'ctrl+alt+r', other: 'alt+shift+f10' },
    { action: 'Toggle Line Breakpoint', command: 'editor.debug.action.toggleBreakpoint', mac: 'ctrlcmd+f8', other: 'ctrl+f8', when: EDITOR },
    { action: 'Step Over', command: 'workbench.action.debug.stepOver', mac: 'f8', other: 'f8', when: IN_DEBUG },
    { action: 'Step Into', command: 'workbench.action.debug.stepInto', mac: 'f7', other: 'f7', when: IN_DEBUG },
    { action: 'Step Out', command: 'workbench.action.debug.stepOut', mac: 'shift+f8', other: 'shift+f8', when: IN_DEBUG },
    { action: 'Resume Program', command: 'workbench.action.debug.continue', mac: 'ctrlcmd+alt+r', other: 'f9', when: IN_DEBUG },
    // Settings
    { action: 'Settings', command: 'ingot.settings.open', mac: 'ctrlcmd+,', other: 'ctrl+alt+s' },
    { action: 'Keymap', command: 'keymaps:open', mac: 'ctrlcmd+alt+k', other: 'ctrl+alt+k' },
    // Version control (IDEA-74)
    { action: 'Commit…', command: 'ingot.commit.open', mac: 'ctrlcmd+k', other: 'ctrl+k' },
    { action: 'Push…', command: 'ingot.commit.push', mac: 'ctrlcmd+shift+k', other: 'ctrl+shift+k' },
    { action: 'Annotate with Git Blame', command: 'ingot.annotate.toggle', mac: 'ctrlcmd+alt+shift+b', other: 'ctrl+alt+shift+b', when: EDITOR },
    { action: 'Commit Message History', command: 'ingot.commit.messageHistory', mac: 'ctrlcmd+alt+h', other: 'ctrl+alt+h', when: 'ingotLocalChangesFocus' },
    // Local History (IDEA-262)
    { action: 'Show Local History', command: LOCAL_HISTORY_COMMANDS.show.id, mac: 'ctrlcmd+alt+shift+h', other: 'ctrl+alt+shift+h' },
    // Agent chat (IDEA-65)
    { action: 'Add Selection to Agent Chat', command: 'ingot.agents.addSelectionToChat', mac: 'ctrlcmd+shift+l', other: 'ctrl+l', when: EDITOR },
    // Inline edit (IDEA-262): Cmd+K with code selected; Commit keeps Cmd+K everywhere else.
    { action: 'Edit Selection with Agent', command: INLINE_EDIT_COMMANDS.start.id, mac: 'ctrlcmd+k', other: 'ctrl+k', when: EDITOR_SELECTION },
    { action: 'Cycle Chat Mode', command: 'ingot.agents.cycleMode', mac: 'ctrlcmd+.', other: 'ctrl+.', when: AGENTS_FOCUS },
    { action: 'New Chat', command: 'ingot.agents.new', mac: 'ctrlcmd+alt+n', other: 'ctrl+alt+n', when: AGENTS_FOCUS },
    { action: 'Chat History', command: 'ingot.agents.history', mac: 'ctrlcmd+alt+y', other: 'ctrl+alt+y', when: AGENTS_FOCUS },
    // Review, threads and disk sync (IDEA-268)
    { action: 'Review Agent Changes', command: 'ingot.agents.reviewChanges', mac: 'ctrlcmd+alt+shift+r', other: 'ctrl+alt+shift+r' },
    { action: 'New Thread in Git Worktree', command: 'ingot.threads.newWorktree', mac: 'ctrlcmd+alt+shift+w', other: 'ctrl+alt+shift+w' },
    { action: 'Reload All from Disk', command: 'ingot.files.reloadFromDisk', mac: 'ctrlcmd+alt+y', other: 'ctrl+alt+y', when: `!${AGENTS_FOCUS}` },
    // Codebase index (IDEA-260)
    { action: INDEX_COMMANDS.rebuild.label, command: INDEX_COMMANDS.rebuild.id, mac: 'ctrlcmd+alt+shift+i', other: 'ctrl+alt+shift+i' }
];

export const KEYMAP_PREFERENCE = 'ingot.keymap';
export const KEYMAP_OPTIONS = ['Ingot (default)', 'Alternative'] as const;
export type KeymapOption = typeof KEYMAP_OPTIONS[number];

/** Double Shift opens Search Everywhere when both presses land within this window. */
export const DOUBLE_SHIFT_MS = 400;
