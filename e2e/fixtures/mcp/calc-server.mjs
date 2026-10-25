// Minimal MCP server over stdio (newline-delimited JSON-RPC) used by the e2e tests.
import { createInterface } from 'node:readline';

const tools = [
    { name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
    { name: 'mode', description: 'Reports the server mode', inputSchema: { type: 'object', properties: {} } }
];
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', line => {
    let request;
    try {
        request = JSON.parse(line);
    } catch {
        return;
    }
    if (request.id === undefined) {
        return;
    }
    if (request.method === 'initialize') {
        send({ id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'calc', version: '1.0.0' } } });
    } else if (request.method === 'tools/list') {
        send({ id: request.id, result: { tools } });
    } else if (request.method === 'tools/call') {
        const { name, arguments: args = {} } = request.params;
        const text = name === 'add' ? String(Number(args.a) + Number(args.b)) : name === 'mode' ? String(process.env.CALC_MODE) : undefined;
        send(text === undefined ? { id: request.id, result: { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true } } : { id: request.id, result: { content: [{ type: 'text', text }] } });
    } else {
        send({ id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } });
    }
});
