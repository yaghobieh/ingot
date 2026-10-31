import type { EffectiveStatus, RuleSource } from '../../common/rules-engine/rules-engine.types';

/** Codicon per rule source in the Rule Hits and Effective Rules panels. */
export const HIT_ICONS: Readonly<Record<RuleSource, string>> = {
    ingot: 'law', external: 'law', legacy: 'law', global: 'globe', agents: 'book', habit: 'checklist'
};

export const STATUS_ICONS: Readonly<Record<EffectiveStatus, string>> = {
    applied: 'pass-filled', available: 'circle-outline', manual: 'mention', 'not-matching': 'circle-slash', overridden: 'arrow-down', shadowed: 'eye-closed'
};

export const PROVENANCE_TEXT = {
    file: 'File',
    source: 'Source',
    git: 'Git',
    loading: 'Loading history…',
    author: 'Last change',
    commit: 'Commit',
    added: 'Added by',
    pack: 'Pack',
    noPack: 'Not from a store pack',
    notCommitted: 'Not committed yet',
    uncommitted: 'uncommitted changes'
} as const;

export const EFFECTIVE_TEXT = {
    placeholder: 'File path, e.g. packages/web/src/app.tsx',
    useActive: 'Use the file open in the editor',
    empty: 'Pick a file to see the rules the agent gets for it, root first, most specific last.',
    merged: 'Merged instructions',
    noRules: 'No rule applies to this file.'
} as const;

/** Monaco language ids the `.ingot` schema providers attach to. */
export const SCHEMA_LANGUAGES = ['markdown', 'json', 'jsonc', 'plaintext'] as const;
/** Characters that open frontmatter / JSON key completion. */
export const SCHEMA_TRIGGER_CHARACTERS = ['"', ':', ' ', '\n'] as const;
