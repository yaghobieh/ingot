const c = (id: string, label: string) => ({ id: `ingot.file.${id}`, label, category: 'File' });

/** Project tree file menu and editor tab menu (IDEA-70, IDEA-58). Each takes a URI, a tab event or the selection. */
export const FILE_MENU_COMMANDS = {
    openToSide: c('openToSide', 'Open to the Side'),
    openInBrowser: c('openInBrowser', 'Open in Browser'),
    openWith: c('openWith', 'Open With…'),
    revealInOS: c('revealInOS', 'Reveal in Finder'),
    openInTerminal: c('openInTerminal', 'Open in Integrated Terminal'),
    selectForCompare: c('selectForCompare', 'Select for Compare'),
    compareWithSelected: c('compareWithSelected', 'Compare with Selected'),
    addToChat: c('addToChat', 'Add File to Agent Chat'),
    addToNewChat: c('addToNewChat', 'Add File to New Agent Chat'),
    openTimeline: c('openTimeline', 'Open Timeline'),
    quickHistory: c('quickHistory', 'Quick File History…'),
    copyPath: c('copyPath', 'Copy Path'),
    copyRelativePath: c('copyRelativePath', 'Copy Relative Path'),
    copyRemoteUrl: c('copyRemoteUrl', 'Copy Remote File URL'),
    copyRemoteUrlFrom: c('copyRemoteUrlFrom', 'Copy Remote File URL From…'),
    rename: c('rename', 'Rename…'),
    delete: c('delete', 'Delete'),
    revealInProject: c('revealInProject', 'Reveal in Project')
} as const;

/** Theia commands the menu items delegate to (all accept a URI argument). */
export const DELEGATES = {
    openWith: 'navigator.openWith',
    revealInOS: 'revealFileInOS',
    openInTerminal: 'terminal:context',
    compareFirst: 'compare:first',
    compareSecond: 'compare:second',
    copyPath: 'core.copy.path',
    copyRelativePath: 'navigator.copyRelativeFilePath',
    rename: 'file.rename',
    delete: 'file.delete',
    reveal: 'navigator.reveal',
    newFile: 'file.newFile',
    newFolder: 'file.newFolder',
    cut: 'core.cut',
    copy: 'core.copy',
    paste: 'core.paste'
} as const;
