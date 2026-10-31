import * as http from 'http';

export interface FakeSlackCall {
    readonly tool: string;
    readonly args: Record<string, unknown>;
}

export interface FakeSlack {
    readonly calls: FakeSlackCall[];
    close(): Promise<void>;
}

const TOOLS = [
    { name: 'slack_search_public', description: 'Search messages in public channels', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'slack_read_channel', description: 'Read recent messages of a channel', inputSchema: { type: 'object', properties: { channel_id: { type: 'string' } } } },
    { name: 'slack_read_thread', description: 'Read the replies of a thread', inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, message_ts: { type: 'string' } } } },
    { name: 'slack_search_users', description: 'Find people in the workspace', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'slack_send_message', description: 'Post a message to a channel', inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, message: { type: 'string' } } } }
];

const SEARCH_RESULT = '#deploys (C123): "Deploy of 0.1.0 finished" (ts 1700000000.000100)';

/**
 * IDEA-270: a local stand-in for the official Slack MCP server (streamable HTTP, JSON responses, bearer token),
 * so e2e drives the real connection path (UI → keychain → backend MCP client → HTTP) without a Slack workspace.
 */
export const startFakeSlack = async (port: number, token: string): Promise<FakeSlack> => {
    const calls: FakeSlackCall[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            if (req.headers.authorization !== `Bearer ${token}`) {
                res.writeHead(401).end();
                return;
            }
            const message = JSON.parse(raw || '{}') as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
            if (message.id === undefined) {
                res.writeHead(202).end();
                return;
            }
            const reply = (body: object): void => {
                res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'e2e-slack' });
                res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body }));
            };
            switch (message.method) {
                case 'initialize': return reply({ result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'slack', version: 'e2e' } } });
                case 'tools/list': return reply({ result: { tools: TOOLS } });
                case 'tools/call': {
                    const tool = message.params?.name ?? '';
                    calls.push({ tool, args: message.params?.arguments ?? {} });
                    return reply({ result: { content: [{ type: 'text', text: tool === 'slack_send_message' ? 'Message posted (ts 1700000001.000200)' : SEARCH_RESULT }] } });
                }
                default: return reply({ error: { code: -32601, message: `Unknown method ${message.method}` } });
            }
        });
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    return { calls, close: () => new Promise(resolve => server.close(() => resolve())) };
};
