export const MAX_RECENT_PROJECTS = 20;
export const MAX_INITIALS = 2;
export const FILE_SCHEME_PREFIX = 'file://';
export const HOME_TILDE = '~';

/** IDEA-165: recent workspaces shown before "Show More..." on the new-window welcome page. */
export const WELCOME_WORKSPACES_VISIBLE = 3;

export interface SuggestedExtension {
    /** Open VSX id: `namespace.name`. */
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly icon: string;
}

/** IDEA-165: a short, curated list from Open VSX. Labels and blurbs are ours; Open VSX supplies the icon and the package. */
export const SUGGESTED_EXTENSIONS: readonly SuggestedExtension[] = [
    { id: 'esbenp.prettier-vscode', label: 'Prettier', description: 'Format JavaScript, TypeScript, CSS and more on save.', icon: 'codicon-wand' },
    { id: 'dbaeumer.vscode-eslint', label: 'ESLint', description: 'Find and fix problems in JavaScript and TypeScript.', icon: 'codicon-checklist' },
    { id: 'redhat.java', label: 'Java', description: 'Java language support: completion, navigation, refactoring.', icon: 'codicon-coffee' }
];
