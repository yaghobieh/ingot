import type { FeatureState } from '../../common/languages/languages.types';

/** IDEA-313: DOM ids of the Languages page (e2e drives them). */
export const LANGUAGES_DOM = {
    root: 'ingot-languages',
    loading: 'ingot-languages-loading',
    summary: 'ingot-languages-summary',
    refresh: 'ingot-languages-refresh',
    table: 'ingot-languages-table',
    toolchains: 'ingot-toolchains'
} as const;

export const FEATURE_STATE_ICONS: Readonly<Record<FeatureState, string>> = {
    ready: 'pass-filled',
    'needs-toolchain': 'warning',
    'missing-extension': 'error',
    'on-demand': 'cloud-download',
    unsupported: 'circle-slash',
    na: 'dash'
};
