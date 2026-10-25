import * as http from 'http';
import type { AddressInfo } from 'net';

const STREAM_DELAY_MS = 25;

export interface FakeOllama {
    readonly url: string;
    readonly requests: { model: string; system: string; user: string }[];
    close(): Promise<void>;
}

/**
 * A local stand-in for an Ollama server (`POST /api/chat`), so e2e exercises the real request path
 * (UI → backend gateway → HTTP) without any API key or network access.
 */
export const startFakeOllama = async (reply: (system: string, user: string) => string): Promise<FakeOllama> => {
    const requests: FakeOllama['requests'] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; messages?: { role: string; content: string }[] };
            const system = body.messages?.find(m => m.role === 'system')?.content ?? '';
            const user = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? '';
            requests.push({ model: body.model ?? '', system, user });
            const content = reply(system, user);
            if (body.stream) {
                // Ollama streams NDJSON: one message delta per line, then a final `done` line.
                res.writeHead(200, { 'content-type': 'application/x-ndjson' });
                const chunks = content.match(/[\s\S]{1,12}/g) ?? [];
                let i = 0;
                const tick = (): void => {
                    if (i < chunks.length) {
                        res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: chunks[i++] }, done: false })}\n`);
                        setTimeout(tick, STREAM_DELAY_MS);
                    } else {
                        res.end(`${JSON.stringify({ model: body.model, done: true })}\n`);
                    }
                };
                tick();
                return;
            }
            res.writeHead(req.url === '/api/chat' ? 200 : 404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content }, done: true }));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(resolve => server.close(() => resolve())) };
};
