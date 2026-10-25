import type { Command } from '@theia/core/lib/common/command';

export const ACCOUNT_STORAGE_KEY = 'ingot.account';
export const ACCOUNT_MENU = ['ingot-account-menu'];
export const ACCOUNT_MENU_INFO = [...ACCOUNT_MENU, '1_info'];
export const ACCOUNT_MENU_ACTIONS = [...ACCOUNT_MENU, '2_actions'];
export const SIGNED_IN_KEY = 'ingotSignedIn';
export const SIGN_IN_PENDING_KEY = 'ingotSignInPending';
export const DEV_SIGN_IN_KEY = 'ingotDevSignIn';
export const ACCOUNT_STATUS_ID = 'ingot-account-status';

export const ACCOUNT_COMMANDS = {
    signIn: { id: 'ingot.account.signIn', label: 'Sign in to Ingot…', category: 'Account' },
    signInDev: { id: 'ingot.account.signInDev', label: 'Sign in as test@ingot.dev (local dev)', category: 'Account' },
    cancelSignIn: { id: 'ingot.account.cancelSignIn', label: 'Cancel Sign-in', category: 'Account' },
    signOut: { id: 'ingot.account.signOut', label: 'Sign Out', category: 'Account' },
    refresh: { id: 'ingot.account.refresh', label: 'Refresh Usage', category: 'Account' },
    dashboard: { id: 'ingot.account.dashboard', label: 'Open Dashboard', category: 'Account' },
    who: { id: 'ingot.account.who', label: 'Account' },
    tokens: { id: 'ingot.account.tokens', label: 'Tokens' },
    show: { id: 'ingot.account.menu', label: 'Account', category: 'Account' }
} as const satisfies Record<string, Command>;

export const ACCOUNT_TEXT = {
    signedOut: 'Account: not signed in',
    signInPending: 'Finish signing in in your browser…',
    settings: 'Settings (Ctrl+Alt+S)'
} as const;
