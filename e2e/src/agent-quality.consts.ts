import * as path from 'path';

/**
 * IDEA-282: the real-model agent quality run. It is opt-in (`npm run agent-quality`), costs real money and is
 * never part of `npm run e2e`. Its own port and config dir keep it apart from other checkouts' e2e servers.
 */
export const AQ_PORT = Number(process.env.INGOT_AQ_PORT ?? 3190);
export const AQ_BASE_URL = `http://127.0.0.1:${AQ_PORT}`;
export const AQ_CONFIG_DIR = path.resolve(__dirname, '..', '.ingot-agent-quality-config');
/** Stand-in for the OS keychain: an absolute file outside the repo, or a gitignored one under e2e. */
export const AQ_KEYSTORE_FILE = process.env.INGOT_DEV_FILE_KEYSTORE ?? path.resolve(__dirname, '..', '.ingot-agent-quality-keystore', 'keystore.json');
export const AQ_KEYCHAIN_SERVICE = process.env.INGOT_AQ_KEYCHAIN_SERVICE ?? 'dev.ingot.ide.agent-quality';
export const AQ_TARGET = process.env.INGOT_AQ_TARGET ?? '/tmp/ingot-e2e-lib';
export const AQ_MODEL_ID = process.env.INGOT_AQ_MODEL ?? 'openrouter-haiku';
export const AQ_PROMPT = `Create a new React (Vite+TS, feature folders) and Node.js (Express+TS, routes/controllers/services) project with full CRUD APIs for a library (books, authors, loans) at path ${AQ_TARGET}`;

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const AQ_REPORT_DIR = path.join(REPO_ROOT, '.ingot-tmp', 'agent-quality');
export const AQ_SHOTS_DIR = path.join(REPO_ROOT, '.ingot-tmp', 'shots');
export const LOCAL_CONFIG_FILE = path.join(REPO_ROOT, 'ingot.config.json');

/** OpenRouter budget: stop before a run when usage reaches 85% of the $25 key limit. */
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
export const BUDGET_LIMIT_USD = 25;
export const BUDGET_STOP_RATIO = 0.85;
export const BUDGET_STOP_USD = BUDGET_LIMIT_USD * BUDGET_STOP_RATIO;
export const OPENROUTER_PROVIDER = 'openrouter';
export const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY';

/** Settings for an unattended run: no approval cards, edits accepted, no review pauses, no Harmony pieces. */
export const AQ_USER_SETTINGS = {
    'ingot.models.byok': true,
    'ingot.agent.defaultModel': AQ_MODEL_ID,
    'ingot.agent.terminal.enabled': true,
    'ingot.agent.terminal.requireApproval': false,
    'ingot.agent.terminal.foregroundTimeoutSeconds': 600,
    'ingot.agent.terminal.maxOutputChars': 12_000,
    'ingot.agent.git.requireApproval': false,
    'ingot.agent.browser.enabled': false,
    'ingot.agent.review.autoAccept': true,
    'ingot.agent.reviewPauseThreshold': 0,
    'ingot.agent.maxToolRounds': 30,
    'ingot.agent.libraryTemplate': false,
    'ingot.zaprex.harmony.enabled': false
} as const;

export const RUN_TIMEOUT_MS = 50 * 60_000;
export const VERIFY_TIMEOUT_MS = 20 * 60_000;
export const TRACE_POLL_MS = 1_500;
/** A run that is idle this long is finished (the review and loop hand-offs take a moment). */
export const IDLE_SETTLE_MS = 8_000;
/** "Continue" messages sent when the agent used its tool rounds or stopped before the project builds. */
export const MAX_CONTINUES = 6;
export const CONTINUE_PROMPT = 'Continue until the task is complete: every file written, npm install, npm run build and npm test passing in both apps. Do not stop to ask.';
export const ASK_ANSWER = 'Use your best judgement and continue without asking again.';
export const TOOL_ROUNDS_STOP_TEXT = 'Stopped: the agent used its tool rounds';

export const NPM_TIMEOUT_MS = 8 * 60_000;
export const API_PORT = 4517;
export const API_READY_TIMEOUT_MS = 40_000;
export const API_POLL_MS = 500;
export const OUTPUT_TAIL_CHARS = 1_500;
export const TRACE_LINE_CHARS = 220;
export const HTTP_OK_MIN = 200;
export const HTTP_OK_MAX = 299;
