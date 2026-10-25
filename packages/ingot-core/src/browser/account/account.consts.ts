import type { Command } from '@theia/core/lib/common/command';

export const ACCOUNT_STORAGE_KEY = 'ingot.account';
export const ACCOUNT_MENU = ['ingot-account-menu'];
export const SIGNED_IN_KEY = 'ingotSignedIn';

export const ACCOUNT_COMMANDS = {
    signIn: { id: 'ingot.account.signIn', label: 'Sign in to Ingot…', category: 'Account' },
    signOut: { id: 'ingot.account.signOut', label: 'Sign Out', category: 'Account' },
    show: { id: 'ingot.account.menu', label: 'Account', category: 'Account' }
} as const satisfies Record<string, Command>;

export const ACCOUNT_TEXT = {
    signedOut: 'Account: not signed in',
    signInSoon: 'Signing in to your Ingot account (Google or GitHub) arrives with the Ingot account service; your projects work without it.',
    settings: 'Settings (Ctrl+Alt+S)'
} as const;
