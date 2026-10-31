export const WELCOME_WIDGET_ID = 'ingot-welcome';
export const WELCOME_WIDGET_LABEL = 'Welcome to Ingot';

export const WELCOME_COMMANDS = {
    openFolder: 'workspace:openFolder',
    openRecent: 'workspace:openRecent'
} as const;

export const CLONE_PROMPT = 'Repository URL (https or ssh)';
export const CLONE_PLACEHOLDER = 'https://github.com/owner/repo.git';
export const CLONE_TARGET_TITLE = 'Choose where to clone the repository';
export const CLONE_TARGET_LABEL = 'Clone Here';
export const CLONE_INVALID = 'Enter an https or ssh Git URL.';

/** IDEA-266: Connect via SSH opens an `ssh` session in the Terminal. */
export const SSH_PROMPT = 'SSH host (user@host or user@host:port)';
export const SSH_PLACEHOLDER = 'me@build.example.com';
export const SSH_INVALID = 'Enter a host like user@host or user@host:2222.';
export const SSH_COMMAND = 'ssh';

/** IDEA-266: body class of a window without a folder (welcome only, no tool windows or agent chat). */
export const NO_FOLDER_BODY_CLASS = 'ingot-no-folder';
/** The logo size on the welcome screen. */
export const WELCOME_MARK_SIZE = 30;

export const WELCOME_CARDS = [
    { id: 'ingot-welcome-open', icon: 'codicon-folder-opened', label: 'Open project' },
    { id: 'ingot-welcome-clone', icon: 'codicon-repo-clone', label: 'Clone repo' },
    { id: 'ingot-welcome-ssh', icon: 'codicon-terminal', label: 'Connect via SSH' }
] as const;
