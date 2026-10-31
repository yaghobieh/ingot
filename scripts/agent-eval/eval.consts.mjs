import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_SERVER = 'http://127.0.0.1:3300';
export const GATEWAY_PATH = '/v1';
export const TOKEN_PATH = '/api/ide/token';
export const REFRESH_GRANT = 'refresh_token';
export const TOKEN_ENV = 'INGOT_EVAL_TOKEN';
export const KEYSTORE_ENV = 'INGOT_DEV_FILE_KEYSTORE';
export const DEV_KEYSTORE_FILE = join(homedir(), '.ingot', 'dev-secrets.json');
export const DEV_KEYSTORE_SERVICE = 'dev.ingot.ide';
export const SESSION_ACCOUNT = 'ingot-account-session';
export const TOKEN_SKEW_MS = 60_000;
export const MS_PER_SECOND = 1000;
export const PREFERRED_MODELS = [/^ingot-smart$/, /^ingot-fast$/];

export const MAX_ROUNDS = 16;
export const MAX_FIX_ATTEMPTS = 3;
export const MAX_TOKENS = 8192;
export const REQUEST_TIMEOUT_MS = 300_000;
export const COMMAND_TIMEOUT_MS = 120_000;
export const MAX_RESULT_CHARS = 12_000;
export const MAX_GREP_MATCHES = 200;
export const MAX_LIST_DEPTH = 3;
export const OUT_DIR = join('.ingot-tmp', 'agent-eval');
export const SKIP_DIRS = new Set(['node_modules', '.git']);
export const TOOL_SERVER = 'ingot';
export const CUT_MARK = '\n… (cut)';

export const ASK_USER_ANSWER = 'No preference. Pick the simplest reasonable option and continue without asking again.';
export const NO_BACKGROUND = 'Background processes are not available in this run. Run the command in the foreground.';
export const NO_GIT_WRITES = 'Skipped by the user: do not commit or change git state for this task.';
export const BLOCKED = 'Blocked: the command reaches outside the project or the network. Stay inside the project folder.';
/** Commands a real model may not run on the eval machine: they leave the temp project, escalate or touch the network. */
export const BLOCKED_COMMAND = /\bsudo\b|\brm\s+-[a-z]*\s+[~/]|\bgit\s+(push|remote)\b|\bnpm\s+publish\b|\bcurl\b|\bwget\b|~\/|\$HOME|\.\.\//;
