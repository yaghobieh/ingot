export const WELCOME_WIDGET_ID = 'ingot-welcome';
export const WELCOME_WIDGET_LABEL = 'Welcome to Ingot';

export const WELCOME_COMMANDS = {
    openFolder: 'workspace:openFolder',
    openWorkspace: 'workspace:openWorkspace',
    plugins: 'vsxExtensions.toggle'
} as const;

export const CLONE_PROMPT = 'Repository URL (https or ssh)';
export const CLONE_PLACEHOLDER = 'https://github.com/owner/repo.git';
export const CLONE_TARGET_TITLE = 'Choose where to clone the repository';
export const CLONE_TARGET_LABEL = 'Clone Here';

export const THEME_CHOICES = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' }
] as const;
