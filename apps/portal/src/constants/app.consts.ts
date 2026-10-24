import type { Locale, TeamRole, ThemePreference } from '@/types/domain.types';

export const APP_NAME = 'Ingot';
export const SESSION_COOKIE = 'ingot_session';
export const THEME_COOKIE = 'ingot_theme';
export const LOCALE_COOKIE = 'ingot_locale';
export const OAUTH_STATE_COOKIE = 'ingot_oauth_state';
export const OAUTH_NEXT_COOKIE = 'ingot_oauth_next';
export const PENDING_EMAIL_KEY = 'ingot.pendingEmail';

export const LOCALES: Locale[] = ['en', 'he', 'es'];
export const DEFAULT_LOCALE: Locale = 'en';
export const RTL_LOCALES: Locale[] = ['he'];
export const THEMES: ThemePreference[] = ['light', 'dark', 'system'];
export const DEFAULT_THEME: ThemePreference = 'system';
export const TEAM_ROLES: TeamRole[] = ['owner', 'admin', 'member'];
export const INVITABLE_ROLES: TeamRole[] = ['admin', 'member'];
export const USAGE_RANGES = [7, 30, 90] as const;
export const DEFAULT_USAGE_DAYS = 30;
export const USAGE_PAGE_SIZE = 50;
export const MICROS_PER_USD = 1_000_000;
export const COOKIE_MAX_AGE_YEAR = 31_536_000;

export const ROUTES = {
    home: '/',
    pricing: '/pricing',
    signIn: '/sign-in',
    signUp: '/sign-up',
    verify: '/verify',
    device: '/device',
    dashboard: '/dashboard',
    usage: '/dashboard/usage',
    models: '/dashboard/models',
    billing: '/dashboard/billing',
    keys: '/dashboard/keys',
    team: '/dashboard/team',
    settings: '/dashboard/settings'
} as const;
