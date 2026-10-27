import * as http from 'http';
import type { AddressInfo } from 'net';

const STREAM_DELAY_MS = 25;
const STREAM_CHUNK_CHARS = 12;

export interface FakeOllamaOptions {
    /** Characters per streamed delta (default 12). */
    readonly chunkSize?: number;
    /** Delay between deltas in ms (default 25). */
    readonly delayMs?: number;
}

export interface FakeOllama {
    readonly url: string;
    /** `user` is the latest user turn. `users` is every user turn in that request, oldest first. */
    readonly requests: { model: string; system: string; user: string; users: string[] }[];
    close(): Promise<void>;
}

/**
 * A local stand-in for an Ollama server (`POST /api/chat`), so e2e exercises the real request path
 * (UI → backend gateway → HTTP) without any API key or network access.
 */
export const startFakeOllama = async (reply: (system: string, user: string) => string, options: FakeOllamaOptions = {}): Promise<FakeOllama> => {
    const { chunkSize = STREAM_CHUNK_CHARS, delayMs = STREAM_DELAY_MS } = options;
    const requests: FakeOllama['requests'] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; messages?: { role: string; content: string }[] };
            const system = body.messages?.find(m => m.role === 'system')?.content ?? '';
            const users = (body.messages ?? []).filter(m => m.role === 'user').map(m => m.content);
            const user = users[users.length - 1] ?? '';
            requests.push({ model: body.model ?? '', system, user, users });
            const content = reply(system, user);
            if (body.stream) {
                // Ollama streams NDJSON: one message delta per line, then a final `done` line.
                res.writeHead(200, { 'content-type': 'application/x-ndjson' });
                const chunks = content.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [];
                let i = 0;
                const tick = (): void => {
                    if (i < chunks.length) {
                        res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: chunks[i++] }, done: false })}\n`);
                        setTimeout(tick, delayMs);
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
