import type { McpServerConfig, McpServerStatus } from '../project-config/project-config.types';
import { headerSecretName } from '../project-config/project-config.utils';
import type { AgentAction } from '../agents/agent-actions';
import type { AgentToolCall } from '../agents/agent-protocol';
import {
    SLACK_AUTH_ERROR_PATTERN, SLACK_AUTH_HEADER, SLACK_AUTH_SCHEME, SLACK_CHANNEL_ARGS, SLACK_MCP_URL, SLACK_SERVER_NAME, SLACK_TEXT, SLACK_TEXT_ARGS,
    SLACK_TOKEN_PREFIXES, SLACK_TOOL_PREFIX, SLACK_WRITE_VERBS
} from './slack-connection.consts';
import type { SlackConnectionView } from './slack-connection.types';

/** Global server config for the official Slack MCP server; the token lives in the keychain as the Authorization header. */
export const slackServerConfig = (url: string = SLACK_MCP_URL): McpServerConfig => ({
    name: SLACK_SERVER_NAME, source: 'user', url, secretHeaders: [SLACK_AUTH_HEADER]
});

/** Error text for a pasted token, or undefined when it looks like a Slack OAuth token. */
export const validateSlackToken = (token: string): string | undefined => {
    const value = token.trim();
    if (!value) {
        return SLACK_TEXT.tokenRequired;
    }
    return SLACK_TOKEN_PREFIXES.some(p => value.startsWith(p)) && !/\s/.test(value) ? undefined : SLACK_TEXT.tokenInvalid;
};

/** Keychain secrets for `IngotMcpClient.addServer`: the full `Authorization` header value. */
export const slackSecrets = (token: string): Record<string, string> => ({
    [headerSecretName(SLACK_AUTH_HEADER)]: `${SLACK_AUTH_SCHEME} ${token.trim()}`
});

/** Card state from the configured server, whether it is on, and its live status. */
export const slackConnectionView = (config: McpServerConfig | undefined, enabled: boolean, status: McpServerStatus | undefined): SlackConnectionView => {
    if (!config) {
        return { state: 'disconnected', summary: SLACK_TEXT.notConnected, tools: 0 };
    }
    if (!enabled) {
        return { state: 'off', summary: SLACK_TEXT.turnedOff, tools: 0 };
    }
    switch (status?.state) {
        case 'connected': {
            const tools = status.tools.length;
            return { state: 'connected', summary: `Connected · ${tools} tool${tools === 1 ? '' : 's'}`, tools };
        }
        case 'needs-auth': return { state: 'needs-token', summary: SLACK_TEXT.needsToken, tools: 0 };
        case 'error': return { state: 'error', summary: SLACK_AUTH_ERROR_PATTERN.test(status.error ?? '') ? SLACK_TEXT.rejected : status.error || SLACK_TEXT.rejected, tools: 0 };
        default: return { state: 'connecting', summary: SLACK_TEXT.connecting, tools: 0 };
    }
};

/** Whether a tool call writes to Slack (post, reply, schedule…): those always show the approval card. */
export const isSlackPostTool = (server: string, tool: string): boolean => {
    const name = tool.toLowerCase();
    if (server !== SLACK_SERVER_NAME && !name.startsWith(SLACK_TOOL_PREFIX)) {
        return false;
    }
    const words = name.split(/[_\W]+/);
    return SLACK_WRITE_VERBS.some(v => words.includes(v));
};

const firstString = (args: Record<string, unknown>, names: readonly string[]): string => {
    const key = names.find(n => typeof args[n] === 'string' && args[n]);
    return key ? String(args[key]) : '';
};

/** Approval card for a Slack write: "Post to Slack: <channel>: <text>", never skippable with "Always Run". */
export const slackPostAction = (call: AgentToolCall): AgentAction => {
    const channel = firstString(call.args, SLACK_CHANNEL_ARGS);
    const text = firstString(call.args, SLACK_TEXT_ARGS);
    const fallback = Object.values(call.args).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
    const detail = channel || text ? [channel, text].filter(Boolean).join(': ') : fallback;
    return { kind: 'mcp', label: `${SLACK_TEXT.postLabel} (${call.tool})`, detail, alwaysAsk: true };
};
