import { describe, expect, it } from 'vitest';
import {
    afterMcpPayload, afterShellPayload, hookToolLabel, mcpPayload, postToolPayload, preCompactPayload, shellPayload, subagentStartPayload, subagentStopPayload,
    toolFailurePayload, toolFailureType, toolPayload
} from './hook-payloads.utils';

const run = { server: 'ingot', tool: 'run', args: { command: 'npm test' } };
const mcp = { server: 'github', tool: 'create_issue', args: { title: 'Bug' } };

describe('IDEA-287 hook payloads', () => {
    it('describes tool calls with Cursor tool names', () => {
        expect(hookToolLabel(mcp)).toBe('github/create_issue');
        expect(toolPayload(run, 'ingot', 't1', '/p')).toEqual({ tool_name: 'Shell', tool_input: { command: 'npm test' }, tool_use_id: 't1', cwd: '/p' });
        expect(postToolPayload(mcp, 'ingot', 't2', { text: 'ok' }, 12)).toEqual({
            tool_name: 'MCP:create_issue', tool_input: { title: 'Bug' }, tool_use_id: 't2', tool_output: '{"output":"ok","isError":false}', duration: 12
        });
        expect(toolFailurePayload(run, 'ingot', 't3', 'Command timed out', toolFailureType('Command timed out', false), 30)).toMatchObject({ failure_type: 'timeout', is_interrupt: false });
        expect(toolFailureType('nope', true)).toBe('permission_denied');
        expect(toolFailureType('exit 1', false)).toBe('error');
    });

    it('builds shell and MCP payloads', () => {
        expect(shellPayload('ls', '/p')).toEqual({ command: 'ls', cwd: '/p', sandbox: false });
        expect(afterShellPayload('ls', 'a\nb', 5, true)).toEqual({ command: 'ls', output: 'a\nb', duration: 5, sandbox: true });
        expect(mcpPayload(mcp, { url: 'https://mcp.example.com' })).toEqual({
            tool_name: 'create_issue', tool_input: '{"title":"Bug"}', mcp_server_name: 'github', server: 'github', url: 'https://mcp.example.com', mcp_server_url: 'https://mcp.example.com'
        });
        expect(mcpPayload(mcp, { command: 'npx gh-mcp' })).toMatchObject({ command: 'npx gh-mcp' });
        expect(JSON.parse(String(afterMcpPayload(mcp, { text: 'done' }, 7).result_json))).toEqual({ content: [{ type: 'text', text: 'done' }], isError: false });
    });

    it('builds preCompact and subagent payloads', () => {
        expect(preCompactPayload({ trigger: 'manual', tokens: 500, window: 1000, messageCount: 8, firstCompaction: true })).toEqual({
            trigger: 'manual', context_usage_percent: 50, context_tokens: 500, context_window_size: 1000, message_count: 8, messages_to_compact: 8, is_first_compaction: true
        });
        expect(preCompactPayload({ trigger: 'auto', tokens: 5, window: 0, messageCount: 1, firstCompaction: false }).context_usage_percent).toBe(0);
        const info = { id: 's1', type: 'generalPurpose', task: 'Fix it', parentId: 'c1', model: 'm', parallel: true };
        expect(subagentStartPayload(info)).toEqual({
            subagent_id: 's1', subagent_type: 'generalPurpose', task: 'Fix it', parent_conversation_id: 'c1', tool_call_id: 's1', subagent_model: 'm', is_parallel_worker: true
        });
        expect(subagentStopPayload(info, {
            status: 'completed', description: 'Fix', summary: 'Done', durationMs: 9, messageCount: 3, toolCallCount: 1, loopCount: 0, files: ['a.ts']
        })).toMatchObject({ subagent_type: 'generalPurpose', status: 'completed', modified_files: ['a.ts'], loop_count: 0 });
    });
});
