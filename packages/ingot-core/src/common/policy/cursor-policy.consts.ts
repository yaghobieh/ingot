import type { PolicyOverlay } from './cursor-policy.types';

/** IDEA-287: Cursor's agent permissions and sandbox files, read while the workspace keeps `.cursor` live. */
export const CURSOR_CLI_FILE = '.cursor/cli.json';
export const CURSOR_SANDBOX_FILE = '.cursor/sandbox.json';
/** IDEA-287: allowlists and auto-review guidance; `.ingot/permissions.json` is Ingot's own copy (read in every mode). */
export const CURSOR_PERMISSIONS_FILE = '.cursor/permissions.json';
export const INGOT_PERMISSIONS_FILE = '.ingot/permissions.json';
/** IDEA-287: user-level files in `~/.cursor`, read in every mode; the project's files win over them. */
export const USER_CURSOR_FILES = { cli: 'cli-config.json', sandbox: 'sandbox.json', permissions: 'permissions.json' } as const;

/** `Shell(git:push)`, `Write(src/**)`, `WebFetch(github.com)`. */
export const CURSOR_PERMISSION_PATTERN = /^(Shell|Read|Write|WebFetch|Mcp)\((.*)\)$/;
/** `Shell(npm:*)` means any npm arguments; `cmd:args` is `cmd args`. */
export const CURSOR_SHELL_ANY_ARGS = ':*';
export const CURSOR_SHELL_ARGS_SEPARATOR = ':';
/** A permissions.json `terminalAllowlist` entry's args glob (`npm:install*`): the trailing `*` is implied by prefix matching. */
export const TRAILING_WILDCARD = /\*+$/;

export const CURSOR_SANDBOX_TYPES = { readwrite: 'workspace_readwrite', readonly: 'workspace_readonly', none: 'insecure_none' } as const;
/** sandbox.json fields Ingot has no rule for; listed as not applied so nothing is silently dropped. */
export const CURSOR_SANDBOX_UNSUPPORTED_LISTS = ['additionalReadonlyPaths', 'additionalReadPaths'] as const;
export const CURSOR_SANDBOX_UNSUPPORTED_FLAGS = ['readBoundary', 'disableTmpWrite', 'enableSharedBuildCache', 'networkPolicyStrict'] as const;
/** `workspace_readonly`: nothing in the project is writable. */
export const READONLY_WORKSPACE_GLOB = '**';

export const EMPTY_OVERLAY: PolicyOverlay = {
    commandsAllow: [], commandsDeny: [], readOnly: [], networkAllow: [], networkDeny: [], allowWrite: [], mcpAllow: [], autoRunAllow: [], autoRunBlock: [], ignored: []
};
