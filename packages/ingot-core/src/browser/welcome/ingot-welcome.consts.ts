export const WELCOME_WIDGET_ID = 'ingot-welcome';
export const WELCOME_WIDGET_LABEL = 'Welcome to Ingot';

export const WELCOME_COMMANDS = {
    openFolder: 'workspace:openFolder',
    newFile: 'workbench.action.files.newUntitledFile',
    plugins: 'vsxExtensions.toggle',
    keymap: 'keymaps:open',
    settings: 'preferences:open'
} as const;

export const CLONE_PROMPT = 'Repository URL (https or ssh)';
export const CLONE_TERMINAL_TITLE = 'Get from VCS';
export const SYNC_WITH_OS = 'Sync with OS';
export const LEARN_LINKS = [
    { label: 'Ingot on GitHub', url: 'https://github.com/yaghobieh/ingot' },
    { label: 'IntelliJ keymap reference', url: 'https://resources.jetbrains.com/storage/products/intellij-idea/docs/IntelliJIDEA_ReferenceCard.pdf' },
    { label: 'Open VSX registry', url: 'https://open-vsx.org' }
] as const;
