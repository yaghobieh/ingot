import type { Command } from '@theia/core/lib/common/command';

export const RULES_TOOLS_SERVICE_PATH = '/services/ingot/rules-tools';

export const RULES_TOOLS_COMMANDS = {
    export: { id: 'ingot.rules.export', label: 'Export Rules to Other Tools…', category: 'Rules' } as Command
};

export const EXPORT_ACTION_LABELS = { create: 'New', update: 'Update', delete: 'Delete', unchanged: 'Up to date', skipped: 'Skipped' } as const;
export const NO_PROJECT_MESSAGE = 'Open a project first.';
