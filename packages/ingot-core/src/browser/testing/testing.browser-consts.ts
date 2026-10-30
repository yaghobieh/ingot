import type { Command } from '@theia/core/lib/common/command';
import { TEST_COMMAND_IDS, TEST_EXPLORER_WIDGET_ID } from '../../common/testing/testing.consts';

/** IDEA-261: the Test Explorer tool window. */
export { TEST_EXPLORER_WIDGET_ID };
export const TEST_EXPLORER_LABEL = 'Tests';
export const TEST_EXPLORER_ICON = 'codicon codicon-beaker';

export const TEST_COMMANDS = {
    toggle: { id: TEST_COMMAND_IDS.toggle, label: 'Test Explorer', category: 'View' },
    refresh: { id: TEST_COMMAND_IDS.refresh, label: 'Refresh Tests', category: 'Test' },
    runAll: { id: TEST_COMMAND_IDS.runAll, label: 'Run All Tests', category: 'Test' },
    rerunFailed: { id: TEST_COMMAND_IDS.rerunFailed, label: 'Rerun Failed Tests', category: 'Test' }
} as const satisfies Record<string, Command>;

export const TEST_EXPLORER_TEXT = {
    noFolder: 'Open a folder to see its tests.',
    loading: 'Looking for tests…',
    noRunner: 'No test runner found. Ingot detects vitest, jest, mocha and Playwright.',
    noTests: 'No test files found (*.test.* or *.spec.*).',
    notRun: 'Not run yet',
    running: 'Running…'
} as const;
