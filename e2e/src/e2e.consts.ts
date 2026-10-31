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
export const E2E_KEYSTORE_FILE = process.env.INGOT_DEV_FILE_KEYSTORE ?? path.resolve(__dirname, '..', '.ingot-e2e-keystore', 'keystore.json');
/** Chromium switch: Electron's own encryption skips the macOS login keychain, so e2e never shows a keychain prompt. */
export const MOCK_KEYCHAIN_ARG = '--use-mock-keychain';
/** IDEA-185: Zaprex desktop detection override ("installed" / "missing"; real detection when absent) and the link log (links are recorded, never opened). */
export const ZAPREX_DETECT_FILE = path.join(E2E_CONFIG_DIR, `zaprex-detect-${process.env.INGOT_PORT ?? 3100}`);
export const ZAPREX_LINK_LOG = path.join(E2E_CONFIG_DIR, `zaprex-links-${process.env.INGOT_PORT ?? 3100}.log`);
/** IDEA-287: system-wide (enterprise) hooks folder for e2e; empty unless a spec writes hooks.json into it. */
export const SYSTEM_HOOKS_DIR = path.join(E2E_CONFIG_DIR, `system-hooks-${process.env.INGOT_PORT ?? 3100}`);
/** IDEA-287: fake docker for "Project Environment: Build Container Image" (records its arguments). */
export const FAKE_DOCKER_BIN = path.join(FIXTURES_DIR, 'bin', 'fake-docker');
export const FAKE_GH_BIN = path.join(FIXTURES_DIR, 'bin', 'fake-gh');
/** Stands in for the home folder whose imported global config (rules, mcp.json) Ingot reads. */
export const IMPORT_HOME = path.join(FIXTURES_DIR, 'import-home');
export const CALC_SERVER = path.join(FIXTURES_DIR, 'mcp', 'calc-server.mjs');
/** Screenshot folder of cloud runners; it does not exist (and cannot be created) on developer machines. */
export const CLOUD_ARTIFACTS_DIR = '/opt/cursor/artifacts/screenshots';
/** Built-in language plugins (`npm run download:plugins`), for desktop specs that need a language server. */
export const BUILTIN_PLUGINS_ENV = { THEIA_DEFAULT_PLUGINS: `local-dir:${path.resolve(__dirname, '..', '..', 'plugins')}` };
export const APP_READY_TIMEOUT_MS = 120_000;
export const APP_CLOSE_TIMEOUT_MS = 15_000;
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
/** Fake OpenRouter for rule tests (IDEA-320); the app reads INGOT_OPENROUTER_BASE_URL, so e2e never calls the real API. */
export const FAKE_OPENROUTER_PORT = Number(process.env.INGOT_FAKE_OPENROUTER_PORT ?? FAKE_INGOT_PORT + 1);
export const FAKE_OPENROUTER_URL = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
/** The plan that unlocks the Zaprex app entry (title bar T-rex). */
export const PRO_PLUS_PLAN = 'pro+';
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
    'ingot.agent.browser.approveReads': false,
    // IDEA-328: learned rules are opt-in; a spec that turns them on must not leave them on.
    'ingot.rules.learnFromReviews': false,
    // IDEA-281: fixtures with .cursor rules would otherwise show the import prompt in every spec; its own spec turns it on.
    'ingot.import.cursorRules': 'never',
    // IDEA-286: modal editing starts off even if an interrupted run left it on.
    'ingot.editor.modalEditing': false,
    // IDEA-182: an interrupted AI & Zaprex settings run must not leave the T-rex hidden, Commit with AI off or Plan as default.
    'ingot.zaprex.showButton': true,
    'ingot.commit.ai.enabled': true,
    'ingot.agent.defaultMode': 'agent',
    // An interrupted attach-active-file run must not leave the open file attached to every chat.
    'ingot.chat.attachActiveFile': false
} as const;
/** Settings › Tools › AI & Zaprex › Chat › Attach active file automatically. */
export const ATTACH_ACTIVE_FILE = 'ingot.chat.attachActiveFile';
/** dismissNotifications: upper bound of toasts closed in one call, and how long one close click may wait. */
export const MAX_NOTIFICATION_CLOSES = 20;
export const NOTIFICATION_CLOSE_TIMEOUT_MS = 2_000;
