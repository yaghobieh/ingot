import { ROUTES } from '@/constants/app.consts';

export const DASHBOARD_NAV = [
    { href: ROUTES.dashboard, key: 'nav.overview', icon: '◧', testId: 'nav-overview' },
    { href: ROUTES.usage, key: 'nav.usage', icon: '▤', testId: 'nav-usage' },
    { href: ROUTES.models, key: 'nav.models', icon: '◈', testId: 'nav-models' },
    { href: ROUTES.billing, key: 'nav.billing', icon: '◎', testId: 'nav-billing' },
    { href: ROUTES.keys, key: 'nav.keys', icon: '⚿', testId: 'nav-keys' },
    { href: ROUTES.team, key: 'nav.team', icon: '☷', testId: 'nav-team' },
    { href: ROUTES.settings, key: 'nav.settings', icon: '⚙', testId: 'nav-settings' }
] as const;
