import type { Command } from '@theia/core/lib/common/command';

export const RULE_PACKS_WIDGET_ID = 'ingot-rule-packs';
export const RULE_PACKS_WIDGET_LABEL = 'Rule Packs';

export const RULE_PACKS_COMMANDS = {
    toggle: { id: 'ingot.rulePacks.toggle', label: 'Rule Packs', category: 'View' } as Command,
    add: { id: 'ingot.rulePacks.add', label: 'Add Rule Pack…', category: 'Agents' } as Command,
    syncOrg: { id: 'ingot.rulePacks.syncOrg', label: 'Sync Org Rule Packs', category: 'Agents' } as Command,
    install: { id: 'ingot.rulePacks.install', label: 'Install Rule Packs from Lockfile', category: 'Agents' } as Command,
    update: { id: 'ingot.rulePacks.update', label: 'Update Rule Packs', category: 'Agents' } as Command,
    verify: { id: 'ingot.rulePacks.verify', label: 'Verify Rule Packs', category: 'Agents' } as Command
};

export const RULE_PACKS_TEXT = {
    caption: 'Versioned team and org rule packs from the Store (Beta)',
    beta: 'Beta',
    noProject: 'Open a project to add rule packs.',
    empty: 'No rule packs yet. Add one from the Store (e.g. @acme/react-rules@^2); it is pinned in .ingot/ingot-lock.json.',
    add: 'Add pack',
    addPrompt: 'Rule pack from the Store: @publisher/name@range',
    addPlaceholder: '@acme/react-rules@^2',
    invalid: 'Use @publisher/name, optionally @<range> (e.g. @acme/react-rules@^2).',
    sync: 'Sync org packs',
    verify: 'Verify',
    update: 'Update',
    remove: 'Remove',
    enforced: 'Enforced',
    enforcedTooltip: 'Enforced by your organization: cannot be removed, edited or overridden by project rules.',
    org: 'Org',
    files: 'files',
    synced: 'Org packs from team',
    verified: 'All pack files match the lockfile.',
    readOnly: 'is from an org-enforced rule pack and is read-only.',
    working: 'Working…'
} as const;
