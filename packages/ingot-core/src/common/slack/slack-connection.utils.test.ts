import { describe, expect, it } from 'vitest';
import { describeAction, needsApproval } from '../agents/agent-actions';
import { parseMcpJson, toMcpJson } from '../project-config/project-config.utils';
import { SLACK_MCP_URL, SLACK_SERVER_NAME, SLACK_TEXT } from './slack-connection.consts';
import { isSlackPostTool, slackConnectionView, slackPostAction, slackSecrets, slackServerConfig, validateSlackToken } from './slack-connection.utils';

const config = slackServerConfig();

describe('IDEA-270 Slack connection', () => {
    it('uses the official Slack MCP server with the token as a keychain header, never in mcp.json', () => {
        expect(config).toEqual({ name: SLACK_SERVER_NAME, source: 'user', url: SLACK_MCP_URL, secretHeaders: ['Authorization'] });
        const json = toMcpJson([config]);
        expect(json).toContain('"Authorization": "${keychain}"');
        expect(json).not.toContain('xox');
        expect(parseMcpJson(json, 'user')[0]).toMatchObject({ name: SLACK_SERVER_NAME, url: SLACK_MCP_URL, secretHeaders: ['Authorization'] });
        expect(slackServerConfig('http://127.0.0.1:9/mcp').url).toBe('http://127.0.0.1:9/mcp');
    });

    it('stores the token as a bearer Authorization header secret', () => {
        expect(slackSecrets('  xoxp-123  ')).toEqual({ 'header:Authorization': 'Bearer xoxp-123' });
    });

    it('accepts user, bot and rotating tokens only', () => {
        expect(validateSlackToken('xoxp-1-abc')).toBeUndefined();
        expect(validateSlackToken('xoxb-1-abc')).toBeUndefined();
        expect(validateSlackToken('xoxe.xoxp-1-abc')).toBeUndefined();
        expect(validateSlackToken('  ')).toBe(SLACK_TEXT.tokenRequired);
        expect(validateSlackToken('ghp_abc')).toBe(SLACK_TEXT.tokenInvalid);
        expect(validateSlackToken('xoxp-1 abc')).toBe(SLACK_TEXT.tokenInvalid);
    });

    it('maps config and live status to the card state', () => {
        expect(slackConnectionView(undefined, false, undefined).state).toBe('disconnected');
        expect(slackConnectionView(config, false, undefined).state).toBe('off');
        expect(slackConnectionView(config, true, undefined).state).toBe('connecting');
        expect(slackConnectionView(config, true, { name: 'slack', state: 'starting', tools: [] }).summary).toBe(SLACK_TEXT.connecting);
        expect(slackConnectionView(config, true, { name: 'slack', state: 'needs-auth', tools: [] }).state).toBe('needs-token');
        const tools = [{ name: 'slack_search_public' }, { name: 'slack_send_message' }];
        expect(slackConnectionView(config, true, { name: 'slack', state: 'connected', tools })).toEqual({ state: 'connected', summary: 'Connected · 2 tools', tools: 2 });
        expect(slackConnectionView(config, true, { name: 'slack', state: 'error', tools: [], error: 'HTTP 401' })).toMatchObject({ state: 'error', summary: SLACK_TEXT.rejected });
        expect(slackConnectionView(config, true, { name: 'slack', state: 'error', tools: [], error: 'fetch failed' }).summary).toBe('fetch failed');
    });

    it('treats Slack write tools as posts and read tools as reads', () => {
        for (const tool of ['slack_send_message', 'slack_send_message_draft', 'slack_schedule_message', 'slack_post_message', 'slack_reply_to_thread', 'slack_add_reaction', 'slack_create_canvas']) {
            expect(isSlackPostTool('slack', tool)).toBe(true);
        }
        for (const tool of ['slack_search_public', 'slack_search_public_and_private', 'slack_read_channel', 'slack_read_thread', 'slack_search_users', 'slack_get_users', 'slack_read_user_profile']) {
            expect(isSlackPostTool('slack', tool)).toBe(false);
        }
        expect(isSlackPostTool('team-chat', 'slack_post_message')).toBe(true);
        expect(isSlackPostTool('calc', 'add')).toBe(false);
    });

    it('describes a post with channel and text', () => {
        const action = slackPostAction({ server: 'slack', tool: 'slack_send_message', args: { channel_id: 'C123', message: 'Deploy is done' } });
        expect(action).toEqual({ kind: 'mcp', label: 'Post to Slack (slack_send_message)', detail: 'C123: Deploy is done', alwaysAsk: true });
        expect(slackPostAction({ server: 'slack', tool: 'slack_send_message', args: { thread: 'x', n: 2 } }).detail).toBe('x 2');
    });

    it('always asks before posting, even with "Always Run" for MCP tool calls; reads follow the setting', () => {
        const alwaysMcp = { '/p': ['mcp' as const] };
        const post = describeAction({ server: 'slack', tool: 'slack_send_message', args: { channel_id: 'C1', message: 'hi' } })!;
        expect(post.alwaysAsk).toBe(true);
        expect(needsApproval(post, '/p', alwaysMcp, true)).toBe(true);
        const read = describeAction({ server: 'slack', tool: 'slack_search_public', args: { query: 'deploy' } })!;
        expect(read).toEqual({ kind: 'mcp', label: 'slack: slack_search_public', detail: 'deploy' });
        expect(needsApproval(read, '/p', alwaysMcp, true)).toBe(false);
        expect(needsApproval(read, '/other', alwaysMcp, true)).toBe(true);
    });
});
