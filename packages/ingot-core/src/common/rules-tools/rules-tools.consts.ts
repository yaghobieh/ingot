import type { Command } from '@theia/core/lib/common/command';
import { DEFAULT_TEST_MODEL, MODEL_PRICES, MOCK_MODEL, STATE_DIR } from '../rules-kit';

export const RULES_TOOLS_SERVICE_PATH = '/services/ingot/rules-tools';

export const RULES_TOOLS_COMMANDS = {
    export: { id: 'ingot.rules.export', label: 'Export Rules to Other Tools…', category: 'Rules' } as Command,
    test: { id: 'ingot.rules.test', label: 'Test Rules…', category: 'Rules' } as Command,
    prune: { id: 'ingot.rules.prune', label: 'Prune Stale Rules…', category: 'Rules' } as Command
};

export const EXPORT_ACTION_LABELS = { create: 'New', update: 'Update', delete: 'Delete', unchanged: 'Up to date', skipped: 'Skipped' } as const;
export const NO_PROJECT_MESSAGE = 'Open a project first.';

/** Same file `ingot rules test` writes, so the IDE shows the last CLI run too. */
export const TEST_REPORT_FILE = `${STATE_DIR}/rules-test-report.json`;
export const OPENROUTER_KEY_ACCOUNT = 'openrouter';
export const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY';
export const OPENROUTER_BASE_URL_ENV = 'INGOT_OPENROUTER_BASE_URL';
/** Models offered in the Test Rules dialog: the free mock, then the cheap priced ones (default first). */
export const RULE_TEST_MODELS: readonly string[] = [
    MOCK_MODEL, DEFAULT_TEST_MODEL, ...Object.keys(MODEL_PRICES).filter(model => model !== MOCK_MODEL && model !== DEFAULT_TEST_MODEL)
];
export const MOCK_MODEL_LABEL = 'Mock (free, offline)';
export const COST_STEP_USD = 0.01;
export const CAP_DIGITS = 2;
export const NO_KEY_MESSAGE = 'No OpenRouter key. Add one on the Models page (OpenRouter), or use the free mock model.';
export const PRUNE_MIN_DAYS = 1;
export const PRUNE_MAX_DAYS = 3650;
