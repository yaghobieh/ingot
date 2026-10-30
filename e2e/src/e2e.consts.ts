import * as path from 'path';

export const E2E_PORT = Number(process.env.INGOT_PORT ?? 3100);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const FIXTURE_WORKSPACE = path.resolve(__dirname, '..', 'fixtures', 'sample-project');
export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
export const MULTI_ROOT_WORKSPACE = path.join(FIXTURES_DIR, 'multi-root.ingot-workspace');
export const GROUP_FIXTURE = path.join(FIXTURES_DIR, 'fullstack.ingot-group');
export const CONFIG_PROJECT = path.join(FIXTURES_DIR, 'config-project');
/** Override when several checkouts run e2e at once so their keychain entries never collide. */
export const E2E_KEYCHAIN_SERVICE = process.env.INGOT_E2E_KEYCHAIN_SERVICE ?? 'dev.ingot.ide.e2e';
export const E2E_CONFIG_DIR = path.resolve(__dirname, '..', '.ingot-e2e-config');
/** Stand-in for the OS keychain. Kept outside the app config dir so config scans never see secrets. */
export const E2E_KEYSTORE_FILE = path.resolve(__dirname, '..', '.ingot-e2e-keystore', 'keystore.json');
/** IDEA-185: Zaprex desktop detection override ("installed" / "missing"; real detection when absent) and the link log (links are recorded, never opened). */
export const ZAPREX_DETECT_FILE = path.join(E2E_CONFIG_DIR, `zaprex-detect-${process.env.INGOT_PORT ?? 3100}`);
export const ZAPREX_LINK_LOG = path.join(E2E_CONFIG_DIR, `zaprex-links-${process.env.INGOT_PORT ?? 3100}.log`);
/** Stands in for the home folder whose imported global config (rules, mcp.json) Ingot reads. */
export const IMPORT_HOME = path.join(FIXTURES_DIR, 'import-home');
export const CALC_SERVER = path.join(FIXTURES_DIR, 'mcp', 'calc-server.mjs');
export const APP_READY_TIMEOUT_MS = 120_000;
export const SHELL_SELECTOR = '#theia-app-shell';
/**
 * Tests run with Playwright's "Desktop Chrome" device, whose user agent is Windows, so Ingot uses the
 * Windows/Linux Ingot keymap in e2e on every host. The macOS keymap is covered by unit tests.
 */
export const IS_MAC = false;
export const MOD = 'Control';
export const QUICK_INPUT_LABEL = 'Type to narrow down results.';
export const ALT = 'Alt';
/** Platform modifier for tool-window shortcuts: Cmd+N on macOS, Alt+N elsewhere (Ingot keymap). */
export const TOOL_WINDOW_MOD = 'Alt';
export const EXPLORER_TAB = '#shell-tab-explorer-view-container';
export const LEFT_PANEL = '#theia-left-side-panel';

/** Fake ingot-server + portal for the account / gateway e2e (IDEA-101); the browser app is started pointing at it. */
export const FAKE_INGOT_PORT = Number(process.env.INGOT_FAKE_SERVER_PORT ?? 3398);
export const FAKE_INGOT_URL = `http://127.0.0.1:${FAKE_INGOT_PORT}`;
/** IDEA-270: fake Slack MCP server; the app's Slack connection points here instead of mcp.slack.com. */
export const FAKE_SLACK_PORT = Number(process.env.INGOT_FAKE_SLACK_PORT ?? 3397);
export const FAKE_SLACK_MCP_URL = `http://127.0.0.1:${FAKE_SLACK_PORT}/mcp`;
/** e2e user settings: BYOK / Local models on, so specs can use the fake Ollama and key-based models. */
export const E2E_USER_SETTINGS = {
    'ingot.models.byok': true,
    // IDEA-133: agent tools start from their defaults even if an interrupted run left them changed.
    'ingot.agent.terminal.enabled': true,
    'ingot.agent.terminal.requireApproval': true,
    'ingot.agent.browser.enabled': true,
    'ingot.agent.browser.requireApproval': true,
    'ingot.agent.browser.approveReads': false
} as const;
