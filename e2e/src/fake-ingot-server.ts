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
    /** IDEA-124 controls: `/api/me` role, 403 account_blocked on every authed call, models dropped from /v1/models. */
    role: 'user' | 'admin';
    /** IDEA-143: `user.avatarUrl` in status and /api/me ('' = no photo, initials). */
    avatarUrl: string;
    blocked: boolean;
    readonly disabledModels: Set<string>;
    /** Served (in order) instead of the next chat completions, e.g. a 429 with Retry-After. */
    readonly chatErrors: FakeGatewayError[];
    /** GET /v1/config (IDEA-125): flags and update policy served, and who asked (version header, signed in). */
    flags: Record<string, boolean>;
    update: { minVersion?: string; latestVersion?: string; updateAvailable?: boolean; forceUpdate?: boolean };
    readonly configCalls: { version: string; signedIn: boolean }[];
    /** /v1/sync store (IDEA-126), by `kind|key`, and the writes the IDE made. */
    readonly sync: Map<string, FakeSyncItem>;
    readonly syncWrites: { method: string; kind: string; key: string; baseVersion?: number; device?: string }[];
    /** Adds an item as if another device wrote it. */
    seedSync(kind: string, key: string, data: unknown): void;
    /** Ingot Bot (IDEA-154): entitlement and the thread / runs / approvals the IDE panel reads, plus the bot calls it made. */
    readonly bot: FakeBot;
    close(): Promise<void>;
}

export interface FakeBot {
    enabled: boolean;
    messages: { id: number; role: 'user' | 'bot'; kind: string; text: string; runId: string | null; approvalId: string | null; createdAt: string }[];
    runs: { id: string; status: string; prompt: string; source: string; repoId: string | null; repoFullName: string | null; prNumber: number | null; prUrl: string | null; summary: string; computeSeconds: number; error: string | null; createdAt: string; startedAt: string | null; endedAt: string | null }[];
    approvals: { id: string; runId: string; action: string; title: string; reason: string; preview: string; status: string }[];
    readonly calls: { method: string; path: string; authorization: string }[];
}

export interface FakeSyncItem {
    kind: string;
    key: string;
    data: unknown;
    version: number;
    deleted: boolean;
    device: string | null;
    seq: number;
    updatedAt: string;
}

export interface FakeGatewayError {
    readonly status: number;
    readonly code: string;
    readonly message: string;
    readonly headers?: Record<string, string>;
    readonly details?: Record<string, unknown>;
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
    const state: FakeIngotServer = {
        url: `http://127.0.0.1:${port}`, calls: [], authorizations: [], usedTokens: 0, role: 'user', avatarUrl: '', blocked: false, disabledModels: new Set(), chatErrors: [],
        flags: {}, update: {}, configCalls: [], sync: new Map(), syncWrites: [], seedSync: () => undefined,
        bot: { enabled: true, messages: [], runs: [], approvals: [], calls: [] }, close: async () => undefined
    };
    const access = 'ingot_at_e2e_access';
    const status = () => ({
        user: { id: 'u1', email: 'test@ingot.dev', name: 'Test User', avatarUrl: state.avatarUrl, plan: 'pro' },
        balance: { plan: 'pro', period: { start: '', end: '' }, tokens: { allowance: ALLOWANCE, granted: 0, used: state.usedTokens, remaining: ALLOWANCE - state.usedTokens }, spend: { budgetUsd: null, usedUsd: 0, remainingUsd: null }, byModel: [] },
        activity: []
    });
    let seq = 0;
    const writeSync = (kind: string, key: string, data: unknown, deleted: boolean, device: string | null): { item: FakeSyncItem; previous?: FakeSyncItem } => {
        const previous = state.sync.get(`${kind}|${key}`);
        const item: FakeSyncItem = { kind, key, data: deleted ? null : data, version: (previous?.version ?? 0) + 1, deleted, device, seq: ++seq, updatedAt: new Date().toISOString() };
        state.sync.set(`${kind}|${key}`, item);
        return { item, previous };
    };
    state.seedSync = (kind, key, data) => { writeSync(kind, key, data, false, 'other-device'); };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', state.url);
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const authed = req.headers.authorization === `Bearer ${access}`;
            if (url.pathname === '/api/dev/login') {
                state.authorizations.push({ devLogin: true });
                res.writeHead(302, { location: `${state.url}${url.searchParams.get('next') ?? '/'}`, 'set-cookie': 'ingot_session=e2e-session; Path=/; HttpOnly' }).end();
                return;
            }
            // The portal's Approve button (IDEA-101 headless dev sign-in posts here with the dev-login session).
            if (url.pathname === '/api/ide/authorize' && req.method === 'POST') {
                if (!/ingot_session=e2e-session/.test(req.headers.cookie ?? '')) {
                    send(res, 401, { error: 'unauthorized' });
                    return;
                }
                state.authorizations.push({ devLogin: false });
                const body = JSON.parse(raw || '{}') as { redirectUri?: string; state?: string };
                const redirect = new URL(body.redirectUri ?? '');
                redirect.searchParams.set('code', 'e2e-code');
                redirect.searchParams.set('state', body.state ?? '');
                send(res, 200, { redirectTo: redirect.toString() });
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
            if (url.pathname === '/v1/config') {
                // Works signed out too (update policy before sign-in).
                const version = String(req.headers['x-ingot-ide-version'] ?? '');
                state.configCalls.push({ version, signedIn: authed });
                const u = state.update;
                send(res, 200, {
                    flags: state.flags, values: {}, config: {}, ttlSeconds: 300, signedIn: authed,
                    ide: {
                        version, minVersion: u.minVersion ?? null, latestVersion: u.latestVersion ?? null, updateAvailable: !!u.updateAvailable, forceUpdate: !!u.forceUpdate,
                        downloadUrl: `${state.url}/download`, releaseNotesUrl: `${state.url}/release-notes`
                    }
                });
                return;
            }
            if (!authed) {
                send(res, 401, { error: 'unauthorized' });
                return;
            }
            if (state.blocked) {
                send(res, 403, { error: 'account_blocked' });
                return;
            }
            if (url.pathname === '/api/me') {
                send(res, 200, { user: { ...status().user, role: state.role } });
                return;
            }
            if (url.pathname === '/v1/sync' && req.method === 'GET') {
                const since = Number(url.searchParams.get('since') ?? 0);
                const items = [...state.sync.values()].filter(i => i.seq > since).sort((a, b) => a.seq - b.seq);
                send(res, 200, { items, cursor: items.at(-1)?.seq ?? since, hasMore: false });
                return;
            }
            const syncItem = /^\/v1\/sync\/(settings|rules|keybindings|chats)\/(.+)$/.exec(url.pathname);
            if (syncItem && (req.method === 'PUT' || req.method === 'DELETE')) {
                const [, kind, rawKey] = syncItem;
                const key = decodeURIComponent(rawKey);
                const body = JSON.parse(raw || '{}') as { data?: unknown; baseVersion?: number; device?: string };
                state.syncWrites.push({ method: req.method, kind, key, baseVersion: body.baseVersion, device: body.device });
                const existing = state.sync.get(`${kind}|${key}`);
                if (req.method === 'DELETE' && !existing) {
                    send(res, 404, { error: 'not_found' });
                    return;
                }
                const conflict = !!existing && body.baseVersion !== undefined && body.baseVersion !== existing.version;
                const { item, previous } = writeSync(kind, key, body.data, req.method === 'DELETE', body.device ?? null);
                send(res, 200, { item, conflict, ...(conflict ? { previous } : {}) });
                return;
            }
            if (url.pathname.startsWith('/api/bot')) {
                handleBot(state.bot, req.method ?? 'GET', url, raw, String(req.headers.authorization ?? ''), authed, res);
                return;
            }
            if (url.pathname === '/api/ide/status') {
                send(res, 200, status());
                return;
            }
            if (url.pathname === '/v1/models') {
                // `order` (admin-controlled) differs from the array order on purpose: the picker must follow `order`.
                send(res, 200, { object: 'list', default: 'ingot-fast', data: [
                    { id: 'ingot-fast', name: 'Ingot Fast', context_window: 128000, available: true, order: 20, default: true },
                    { id: 'ingot-mock', name: 'Ingot Mock', context_window: 32000, available: true, order: 10 },
                    // Listed but not offered right now (no provider key on the server): the picker greys it out.
                    { id: 'ingot-reasoning', name: 'Ingot Reasoning', context_window: 200000, available: false, order: 30 }
                ].filter(m => !state.disabledModels.has(m.id)) });
                return;
            }
            if (url.pathname === '/v1/chat/completions') {
                const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; messages?: { role: string; content: unknown }[] };
                state.calls.push({ model: body.model ?? '', authorization: String(req.headers.authorization), feature: String(req.headers['x-ingot-feature'] ?? '') });
                const failure = state.chatErrors.shift();
                if (failure) {
                    res.writeHead(failure.status, { 'content-type': 'application/json', ...failure.headers });
                    res.end(JSON.stringify({ error: { message: failure.message, type: 'ingot_error', code: failure.code, ...failure.details } }));
                    return;
                }
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

/** Mock Ingot Bot: a chat message starts a run that waits for approval; approving finishes it with a draft PR. */
function handleBot(bot: FakeBot, method: string, url: URL, raw: string, authorization: string, authed: boolean, res: http.ServerResponse): void {
    bot.calls.push({ method, path: url.pathname, authorization });
    if (!authed) { send(res, 401, { error: 'unauthorized' }); return; }
    const now = new Date().toISOString();
    const say = (role: 'user' | 'bot', text: string, runId: string | null, kind = 'text', approvalId: string | null = null): void => {
        bot.messages.push({ id: bot.messages.length + 1, role, kind, text, runId, approvalId, createdAt: now });
    };
    const path = url.pathname;
    if (path === '/api/bot/status') {
        send(res, 200, { entitlement: { enabled: bot.enabled, plan: bot.enabled ? 'pro_plus' : 'pro', reason: bot.enabled ? null : 'plan', limits: null }, runner: 'local', runnerLive: true });
        return;
    }
    if (path === '/api/bot/usage') { send(res, 200, { usage: { minutesUsed: 3, minutesLimit: 300, activeRuns: bot.runs.filter(r => r.status === 'awaiting_approval').length, concurrentLimit: 1 } }); return; }
    if (path === '/api/bot/repos') { send(res, 200, { repos: [{ id: 'repo-1', fullName: 'ingot-dev/sample-app', defaultBranch: 'main', enabled: true }] }); return; }
    if (path === '/api/bot/chat' && method === 'GET') { send(res, 200, { messages: bot.messages }); return; }
    if (path === '/api/bot/approvals') { send(res, 200, { approvals: bot.approvals.filter(a => a.status === 'pending') }); return; }
    if (path === '/api/bot/runs') { send(res, 200, { runs: [...bot.runs].reverse() }); return; }
    if (!bot.enabled) { send(res, 403, { error: 'bot_upgrade_required' }); return; }
    if (path === '/api/bot/chat' && method === 'POST') {
        const body = JSON.parse(raw || '{}') as { text?: string; repoId?: string | null };
        const id = `run-${bot.runs.length + 1}`;
        const approvalId = `appr-${bot.approvals.length + 1}`;
        bot.runs.push({ id, status: 'awaiting_approval', prompt: body.text ?? '', source: 'ide', repoId: body.repoId ?? null, repoFullName: body.repoId ? 'ingot-dev/sample-app' : null, prNumber: null, prUrl: null, summary: '', computeSeconds: 42, error: null, createdAt: now, startedAt: now, endedAt: null });
        bot.approvals.push({ id: approvalId, runId: id, action: 'add_dependency', title: 'Add or upgrade dependencies', reason: 'The task adds a package', preview: '+ "date-fns": "^4.1.0"', status: 'pending' });
        say('user', body.text ?? '', id);
        say('bot', 'On it. I started a run and will post updates here.', id);
        say('bot', 'Approval needed: Add or upgrade dependencies', id, 'approval', approvalId);
        send(res, 201, { run: bot.runs.at(-1), messages: bot.messages });
        return;
    }
    const decision = /^\/api\/bot\/approvals\/([\w-]+)$/.exec(path);
    if (decision && method === 'POST') {
        const approval = bot.approvals.find(a => a.id === decision[1]);
        if (!approval || approval.status !== 'pending') { send(res, 409, { error: 'approval_not_pending' }); return; }
        const choice = (JSON.parse(raw || '{}') as { decision?: string }).decision;
        approval.status = choice === 'reject' ? 'rejected' : 'approved';
        const run = bot.runs.find(r => r.id === approval.runId);
        if (run) {
            run.status = choice === 'reject' ? 'cancelled' : 'succeeded';
            run.endedAt = now;
            if (choice !== 'reject') {
                run.prNumber = 7;
                run.prUrl = 'https://github.com/ingot-dev/sample-app/pull/7';
                say('bot', `Run finished. Tests pass. Draft PR: ${run.prUrl}`, run.id);
            } else {
                say('bot', 'Rejected. I stopped the run.', run.id);
            }
        }
        send(res, 200, { approval });
        return;
    }
    const events = /^\/api\/bot\/runs\/([\w-]+)\/events$/.exec(path);
    if (events) {
        send(res, 200, { events: [{ seq: 1, type: 'status', payload: { status: 'running' }, createdAt: now }, { seq: 2, type: 'tool', payload: { command: 'npm test', exitCode: 1 }, createdAt: now }, { seq: 3, type: 'step', payload: { message: 'Fixing sum.mjs' }, createdAt: now }] });
        return;
    }
    const cancel = /^\/api\/bot\/runs\/([\w-]+)\/cancel$/.exec(path);
    if (cancel && method === 'POST') {
        const run = bot.runs.find(r => r.id === cancel[1]);
        if (run) { run.status = 'cancelled'; run.endedAt = now; }
        send(res, 200, { run });
        return;
    }
    send(res, 404, { error: 'not_found' });
}
