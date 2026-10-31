import type { PolicyOverlay } from './cursor-policy.types';

/** IDEA-287: Cursor's agent permissions and sandbox files, read while the workspace keeps `.cursor` live. */
export const CURSOR_CLI_FILE = '.cursor/cli.json';
export const CURSOR_SANDBOX_FILE = '.cursor/sandbox.json';

/** `Shell(git:push)`, `Write(src/**)`, `WebFetch(github.com)`. */
export const CURSOR_PERMISSION_PATTERN = /^(Shell|Read|Write|WebFetch|Mcp)\((.*)\)$/;
/** `Shell(npm:*)` means any npm arguments; `cmd:args` is `cmd args`. */
export const CURSOR_SHELL_ANY_ARGS = ':*';
export const CURSOR_SHELL_ARGS_SEPARATOR = ':';

export const CURSOR_SANDBOX_TYPES = { readwrite: 'workspace_readwrite', readonly: 'workspace_readonly', none: 'insecure_none' } as const;
/** `workspace_readonly`: nothing in the project is writable. */
export const READONLY_WORKSPACE_GLOB = '**';

export const EMPTY_OVERLAY: PolicyOverlay = {
    commandsAllow: [], commandsDeny: [], readOnly: [], networkAllow: [], networkDeny: [], allowWrite: [], ignored: []
};
