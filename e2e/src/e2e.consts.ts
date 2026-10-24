import * as path from 'path';

export const E2E_PORT = Number(process.env.INGOT_PORT ?? 3100);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const FIXTURE_WORKSPACE = path.resolve(__dirname, '..', 'fixtures', 'sample-project');
export const APP_READY_TIMEOUT_MS = 120_000;
export const SHELL_SELECTOR = '#theia-app-shell';
export const IS_MAC = process.platform === 'darwin';
export const MOD = IS_MAC ? 'Meta' : 'Control';
export const QUICK_INPUT_LABEL = 'Type to narrow down results.';
