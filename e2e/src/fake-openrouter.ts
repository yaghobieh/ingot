import * as http from 'http';
import { FAKE_OPENROUTER_PORT } from './e2e.consts';

export interface FakeOpenRouterRequest {
    readonly authorization: string;
    readonly model: string;
    readonly system: string;
    readonly user: string;
    readonly maxTokens: number;
}

export interface FakeOpenRouter {
    readonly requests: FakeOpenRouterRequest[];
    close(): Promise<void>;
}

const PROMPT_TOKENS = 120;
const COMPLETION_TOKENS = 12;
const COST_PER_CALL_USD = 0.00002;

/**
 * Stand-in for OpenRouter's `POST /chat/completions` on FAKE_OPENROUTER_PORT (the app's INGOT_OPENROUTER_BASE_URL), so rule tests
 * exercise the real path (dialog → backend → HTTP with the keychain key) without network access or spend.
 */
export const startFakeOpenRouter = async (reply: (system: string, user: string) => string): Promise<FakeOpenRouter> => {
    const requests: FakeOpenRouterRequest[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
                res.writeHead(404).end();
                return;
            }
            const body = JSON.parse(raw || '{}') as { model?: string; max_tokens?: number; messages?: { role: string; content: string }[] };
            const system = body.messages?.find(m => m.role === 'system')?.content ?? '';
            const user = body.messages?.find(m => m.role === 'user')?.content ?? '';
            requests.push({ authorization: String(req.headers.authorization ?? ''), model: body.model ?? '', system, user, maxTokens: body.max_tokens ?? 0 });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: reply(system, user) } }],
                usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS, cost: COST_PER_CALL_USD }
            }));
        });
    });
    await new Promise<void>(resolve => server.listen(FAKE_OPENROUTER_PORT, '127.0.0.1', resolve));
    return { requests, close: () => new Promise(resolve => server.close(() => resolve())) };
};
