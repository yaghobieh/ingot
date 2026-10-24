import type { WelcomeTab } from './welcome.types';

export const WELCOME_TABS: readonly { readonly id: WelcomeTab; readonly label: string }[] = [
    { id: 'projects', label: 'Projects' },
    { id: 'customize', label: 'Customize' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'learn', label: 'Learn' }
];

export const MAX_RECENT_PROJECTS = 20;
export const MAX_INITIALS = 2;
export const FILE_SCHEME_PREFIX = 'file://';
export const HOME_TILDE = '~';
