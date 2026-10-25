import * as http from 'http';
import { FAKE_INGOT_PORT } from './e2e.consts';

const STREAM_DELAY_MS = 20;
const ALLOWANCE = 1_000_000;

export interface FakeIngotServer {
    readonly url: string;
    /** Bearer tokens and models the IDE sent to /v1/chat/completions. */
    readonly calls: { model: string; authorization: string; feature: string }[];
    /** Authorize-page hits (the browser leg of sign-in), with the dev-login flag. */
    readonly authorizations: { devLogin: boolean }[];
    usedTokens: number;
    close(): Promise<void>;
}

const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
};

/**
 * Stand-in for ingot-server + portal (IDEA-101): PKCE authorize page (auto-approves), dev login, token, status, /v1 models and chat.
 * Every chat call adds its tokens to the account so the IDE's "tokens left" must change.
 */
export const startFakeIngotServer = async (port = FAKE_INGOT_PORT): Promise<FakeIngotServer> => {
    const state: FakeIngotServer = { url: `http://127.0.0.1:${port}`, calls: [], authorizations: [], usedTokens: 0, close: async () => undefined };
    const access = 'ingot_at_e2e_access';
    const status = () => ({
        user: { id: 'u1', email: 'test@ingot.dev', name: 'Test User', avatarUrl: '', plan: 'pro' },
        balance: { plan: 'pro', period: { start: '', end: '' }, tokens: { allowance: ALLOWANCE, granted: 0, used: state.usedTokens, remaining: ALLOWANCE - state.usedTokens }, spend: { budgetUsd: null, usedUsd: 0, remainingUsd: null }, byModel: [] },
        activity: []
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', state.url);
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const authed = req.headers.authorization === `Bearer ${access}`;
            if (url.pathname === '/api/dev/login') {
                state.authorizations.push({ devLogin: true });
                res.writeHead(302, { location: `${state.url}${url.searchParams.get('next') ?? '/'}` }).end();
                return;
            }
            if (url.pathname === '/ide/authorize') {
                state.authorizations.push({ devLogin: false });
                const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
                redirect.searchParams.set('code', 'e2e-code');
                redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
                res.writeHead(302, { location: redirect.toString() }).end();
                return;
            }
            if (url.pathname === '/api/ide/token' && req.method === 'POST') {
                const body = JSON.parse(raw || '{}') as { grant_type?: string; code?: string };
                if (body.code !== 'e2e-code' && body.grant_type !== 'refresh_token') {
                    send(res, 400, { error: 'invalid_grant' });
                    return;
                }
                send(res, 200, { access_token: access, refresh_token: 'ingot_rt_e2e', token_type: 'Bearer', expires_in: 3600, refresh_expires_in: 86400 });
                return;
            }
            if (url.pathname === '/api/ide/revoke') {
                send(res, 200, { ok: true });
                return;
            }
            if (!authed) {
                send(res, 401, { error: 'unauthorized' });
                return;
            }
            if (url.pathname === '/api/ide/status') {
                send(res, 200, status());
                return;
            }
            if (url.pathname === '/v1/models') {
                send(res, 200, { object: 'list', data: [
                    { id: 'ingot-fast', name: 'Ingot Fast', context_window: 128000, available: true },
                    { id: 'ingot-mock', name: 'Ingot Mock', context_window: 32000, available: true },
                    // Listed but not offered right now (no provider key on the server): the picker marks it Unavailable.
                    { id: 'ingot-reasoning', name: 'Ingot Reasoning', context_window: 200000, available: false }
                ] });
                return;
            }
            if (url.pathname === '/v1/chat/completions') {
                const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; messages?: { role: string; content: unknown }[] };
                state.calls.push({ model: body.model ?? '', authorization: String(req.headers.authorization), feature: String(req.headers['x-ingot-feature'] ?? '') });
                const user = [...(body.messages ?? [])].reverse().find(m => m.role === 'user');
                const content = `### Gateway reply\nEcho: ${typeof user?.content === 'string' ? user.content : 'parts'}`;
                const usage = { prompt_tokens: 1200, completion_tokens: 300 };
                state.usedTokens += usage.prompt_tokens + usage.completion_tokens;
                if (!body.stream) {
                    send(res, 200, { id: 'chatcmpl-e2e', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage });
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
                const chunks = content.match(/[\s\S]{1,10}/g) ?? [];
                let i = 0;
                const tick = (): void => {
                    if (i < chunks.length) {
                        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: chunks[i++] } }] })}\n\n`);
                        setTimeout(tick, STREAM_DELAY_MS);
                    } else {
                        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
                        res.end('data: [DONE]\n\n');
                    }
                };
                tick();
                return;
            }
            send(res, 404, { error: 'not_found' });
        });
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    state.close = () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    return state;
};
