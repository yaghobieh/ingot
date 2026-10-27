// Minimal MCP server over stdio for the IDEA-177 tool-card e2e: `get_me` returns a GitHub-style profile.
import { createInterface } from 'node:readline';

const tools = [{ name: 'get_me', description: 'The signed-in user profile', inputSchema: { type: 'object', properties: {} } }];
const profile = {
    login: 'ingot-dev', name: 'Ingot Dev', avatar_url: '', location: 'Tel Aviv, Israel', blog: 'ingot-portal.vercel.app',
    email: 'dev@ingot.dev', public_repos: 45, followers: 2, following: 1, html_url: 'https://github.com/ingot-dev'
};
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
        send({ id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'profile', version: '1.0.0' } } });
    } else if (request.method === 'tools/list') {
        send({ id: request.id, result: { tools } });
    } else if (request.method === 'tools/call') {
        send({ id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(profile) }] } });
    } else {
        send({ id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } });
    }
});
