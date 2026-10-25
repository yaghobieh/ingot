import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import type { MenuPath } from '@theia/core/lib/common/menu';

/** Editor right-click menu, laid out like docs/design/context-menu-reference.png (IDEA-56). */
export const EDITOR_MENU = {
    navigation: [...EDITOR_CONTEXT_MENU, 'ingot_1_navigation'],
    ai: [...EDITOR_CONTEXT_MENU, 'ingot_2_ai'],
    find: [...EDITOR_CONTEXT_MENU, 'ingot_3_find'],
    refactor: [...EDITOR_CONTEXT_MENU, 'ingot_4_refactor'],
    remote: [...EDITOR_CONTEXT_MENU, 'ingot_5_remote'],
    history: [...EDITOR_CONTEXT_MENU, 'ingot_6_history'],
    clipboard: [...EDITOR_CONTEXT_MENU, 'ingot_7_clipboard'],
    palette: [...EDITOR_CONTEXT_MENU, 'ingot_8_palette']
} satisfies Record<string, MenuPath>;

export const EDITOR_SUBMENUS = {
    peek: [...EDITOR_MENU.navigation, 'ingot_peek'],
    openChanges: [...EDITOR_MENU.remote, 'ingot_open_changes'],
    openOnRemote: [...EDITOR_MENU.remote, 'ingot_open_remote'],
    annotations: [...EDITOR_MENU.history, 'ingot_annotations'],
    fileHistory: [...EDITOR_MENU.history, 'ingot_file_history'],
    git: [...EDITOR_MENU.history, 'ingot_git'],
    copyAs: [...EDITOR_MENU.clipboard, 'ingot_copy_as']
} satisfies Record<string, MenuPath>;

const c = (id: string, label: string, category = 'Editor') => ({ id: `ingot.editor.${id}`, label, category });

export const EDITOR_COMMANDS = {
    goToSourceDefinition: c('goToSourceDefinition', 'Go to Source Definition'),
    addSymbolToChat: c('addSymbolToChat', 'Add Symbol to Current Chat', 'Agents'),
    addSymbolToNewChat: c('addSymbolToNewChat', 'Add Symbol to New Chat', 'Agents'),
    createRule: c('createRule', 'Create Rule', 'Agents'),
    findAllReferences: c('findAllReferences', 'Find All References'),
    findAllImplementations: c('findAllImplementations', 'Find All Implementations'),
    showCallHierarchy: c('showCallHierarchy', 'Show Call Hierarchy'),
    openChangesHead: c('openChangesHead', 'Open Changes with HEAD', 'Git'),
    openChangesPrevious: c('openChangesPrevious', 'Open Changes with Previous Revision', 'Git'),
    openOnRemote: c('openOnRemote', 'Open File on Remote', 'Git'),
    copyRemoteUrl: c('copyRemoteUrl', 'Copy Remote File URL', 'Git'),
    toggleBlame: c('toggleBlame', 'Toggle Line Blame', 'Git'),
    blameLine: c('blameLine', 'Show Blame for Current Line', 'Git'),
    quickFileHistory: c('quickFileHistory', 'Quick File History…', 'Git'),
    commitFile: c('commitFile', 'Commit File…', 'Git'),
    rollbackFile: c('rollbackFile', 'Rollback…', 'Git'),
    compareWithBranch: c('compareWithBranch', 'Compare with Branch…', 'Git'),
    compareWithRevision: c('compareWithRevision', 'Compare with Revision…', 'Git'),
    addToGitignore: c('addToGitignore', 'Add to .gitignore', 'Git'),
    copyPath: c('copyPath', 'Copy Path'),
    copyRelativePath: c('copyRelativePath', 'Copy Relative Path'),
    copyReference: c('copyReference', 'Copy Reference'),
    copyMarkdown: c('copyMarkdown', 'Copy as Markdown')
} as const;

/** Built-in editor actions reused as-is, with the reference labels. */
export const MONACO_ACTIONS = {
    definition: 'editor.action.revealDefinition',
    typeDefinition: 'editor.action.goToTypeDefinition',
    implementation: 'editor.action.goToImplementation',
    references: 'editor.action.goToReferences',
    peekDefinition: 'editor.action.peekDefinition',
    peekTypeDefinition: 'editor.action.peekTypeDefinition',
    peekImplementation: 'editor.action.peekImplementation',
    peekReferences: 'editor.action.referenceSearch.trigger',
    rename: 'editor.action.rename',
    changeAll: 'editor.action.changeAll',
    format: 'editor.action.formatDocument',
    refactor: 'editor.action.refactor',
    sourceAction: 'editor.action.sourceAction'
} as const;

export const SOURCE_DEFINITION_PLUGIN_COMMAND = 'typescript.goToSourceDefinition';
export const CALL_HIERARCHY_COMMAND = 'callhierarchy:open';
export const COMMAND_PALETTE = 'workbench.action.showCommands';
