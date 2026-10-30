/** IDEA-270: Slack as a built-in MCP connection, backed by the official Slack MCP server. */

/** Name of the server in the global `~/.ingot/mcp.json`; also the tool prefix the agent sees (`slack/<tool>`). */
export const SLACK_SERVER_NAME = 'slack';

/** The official Slack MCP server (streamable HTTP, bearer token). */
export const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

/** Backend env var that points the connection at another Slack MCP endpoint (e2e uses a local fake). */
export const SLACK_MCP_URL_ENV = 'INGOT_SLACK_MCP_URL';

export const SLACK_AUTH_HEADER = 'Authorization';
export const SLACK_AUTH_SCHEME = 'Bearer';

/** User (`xoxp-`), bot (`xoxb-`) and rotating user (`xoxe.xoxp-`) tokens. */
export const SLACK_TOKEN_PREFIXES: readonly string[] = ['xoxp-', 'xoxb-', 'xoxe.xoxp-'];

/** Where users create a Slack app and copy its OAuth token. */
export const SLACK_APPS_URL = 'https://api.slack.com/apps';

/**
 * Tool-name words that write to Slack. Matching tools always wait for the approval card,
 * even when the user chose "Always Run" for MCP tool calls in the project.
 */
export const SLACK_WRITE_VERBS: readonly string[] = [
    'send', 'post', 'reply', 'schedule', 'draft', 'create', 'update', 'edit', 'delete', 'add', 'react', 'upload', 'invite', 'pin', 'set'
];

/** Tool prefix used by Slack MCP servers (official and reference). */
export const SLACK_TOOL_PREFIX = 'slack_';

/** Argument names Slack MCP servers use for the target channel and the message text, in lookup order. */
export const SLACK_CHANNEL_ARGS: readonly string[] = ['channel_id', 'channel', 'channel_name'];
export const SLACK_TEXT_ARGS: readonly string[] = ['message', 'text', 'markdown_text'];

/** HTTP statuses Slack answers with when the token is wrong, revoked or missing scopes. */
export const SLACK_AUTH_ERROR_PATTERN = /HTTP 40[13]\b|invalid_auth|not_authed|token_revoked|missing_scope/i;

export const SLACK_TEXT = {
    title: 'Slack',
    description: 'Search messages, read channels and threads, list people and post messages from the agent.',
    capabilities: 'Search messages · Read channels and threads · List users · Post messages (always asks first)',
    notConnected: 'Not connected',
    connecting: 'Connecting…',
    turnedOff: 'Turned off in MCP servers',
    needsToken: 'Token missing. Connect again.',
    rejected: 'Slack rejected the token. Check it and connect again.',
    unreachable: 'Could not connect to Slack.',
    connect: 'Connect',
    reconnect: 'Reconnect',
    turnOn: 'Turn on',
    disconnect: 'Disconnect',
    save: 'Save & Connect',
    saving: 'Connecting…',
    cancel: 'Cancel',
    tokenLabel: 'Slack token',
    tokenPlaceholder: 'xoxp-…',
    tokenHint: 'Paste a user token (xoxp-…) or bot token (xoxb-…) from your Slack app’s OAuth & Permissions page. It is stored in the OS keychain, never in files.',
    createApp: 'Create a Slack app',
    tokenRequired: 'Paste your Slack token.',
    tokenInvalid: 'Slack tokens start with xoxp-, xoxb- or xoxe.xoxp-.',
    postLabel: 'Post to Slack'
} as const;
