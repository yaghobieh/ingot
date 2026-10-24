import * as path from 'path';

export const E2E_PORT = Number(process.env.INGOT_PORT ?? 3100);
/** Fake Open VSX registry used instead of open-vsx.org in e2e (`VSX_REGISTRY_URL`). */
export const E2E_OVSX_PORT = Number(process.env.INGOT_E2E_OVSX_PORT ?? 3187);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const FIXTURE_WORKSPACE = path.resolve(__dirname, '..', 'fixtures', 'sample-project');
export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
export const MULTI_ROOT_WORKSPACE = path.join(FIXTURES_DIR, 'multi-root.ingot-workspace');
export const GROUP_FIXTURE = path.join(FIXTURES_DIR, 'fullstack.ingot-group');
export const CONFIG_PROJECT = path.join(FIXTURES_DIR, 'config-project');
export const E2E_KEYCHAIN_SERVICE = 'dev.ingot.ide.e2e';
export const E2E_CONFIG_DIR = path.resolve(__dirname, '..', '.ingot-e2e-config');
export const APP_READY_TIMEOUT_MS = 120_000;
export const SHELL_SELECTOR = '#theia-app-shell';
/**
 * Tests run with Playwright's "Desktop Chrome" device, whose user agent is Windows, so Ingot uses the
 * Windows/Linux IntelliJ keymap in e2e on every host. The macOS keymap is covered by unit tests.
 */
export const IS_MAC = false;
export const MOD = 'Control';
export const QUICK_INPUT_LABEL = 'Type to narrow down results.';
export const ALT = 'Alt';
/** Platform modifier for tool-window shortcuts: Cmd+N on macOS, Alt+N elsewhere (IntelliJ keymap). */
export const TOOL_WINDOW_MOD = 'Alt';
export const EXPLORER_TAB = '#shell-tab-explorer-view-container';
export const LEFT_PANEL = '#theia-left-side-panel';
