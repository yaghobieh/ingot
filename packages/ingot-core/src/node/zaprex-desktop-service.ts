import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import {
    HANDOFF_ACTIVE, HANDOFF_CLAIM_TTL_MS, HANDOFF_MAX_BODY_BYTES, handoffDeepLink, parseResultBody, parseStatusBody, ZAPREX_HANDOFF_VERSION,
    type HandoffStatus, type HarmonyHandoff, type ZaprexDesktopInfo, type ZaprexPlatform
} from '../common/zaprex/handoff';
import type { ZaprexDesktopService } from '../common/zaprex/zaprex-desktop.types';

interface Entry {
    readonly handoff: HarmonyHandoff;
    readonly token: string;
    status: HandoffStatus;
    claimedAt?: number;
}

const platform = (): ZaprexPlatform => process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
const run = (cmd: string, args: string[]): Promise<string> => new Promise(resolve =>
    execFile(cmd, args, { timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout))));

/**
 * IDEA-185: loopback-only handoff server (127.0.0.1, random port, per-piece bearer token, no CORS so web pages
 * cannot use it) plus desktop app detection and deep links.
 * Test hooks: INGOT_ZAPREX_DETECT_FILE (file with "installed" / "missing"), INGOT_ZAPREX_LINK_LOG (record links instead of opening them).
 */
@injectable()
export class IngotZaprexDesktopService implements ZaprexDesktopService {

    protected server?: http.Server;
    protected port = 0;
    protected readonly entries = new Map<string, Entry>();

    async detect(): Promise<ZaprexDesktopInfo> {
        const forced = process.env.INGOT_ZAPREX_DETECT_FILE;
        if (forced && fs.existsSync(forced)) {
            return { installed: fs.readFileSync(forced, 'utf8').trim() === 'installed', platform: platform() };
        }
        const p = platform();
        if (p === 'mac') {
            const apps = ['/Applications/Zaprex.app', path.join(os.homedir(), 'Applications', 'Zaprex.app')];
            return { installed: apps.some(a => fs.existsSync(a)), platform: p };
        }
        if (p === 'windows') {
            return { installed: !!(await run('reg', ['query', 'HKCU\\Software\\Classes\\zaprex'])).trim() || !!(await run('reg', ['query', 'HKCR\\zaprex'])).trim(), platform: p };
        }
        return { installed: !!(await run('xdg-mime', ['query', 'default', 'x-scheme-handler/zaprex'])).trim(), platform: p };
    }

    async open(url: string): Promise<void> {
        if (!/^(zaprex:\/\/|https:\/\/zaprex\.dev\/)/.test(url)) {
            throw new Error('Only Zaprex links can be opened here.');
        }
        const log = process.env.INGOT_ZAPREX_LINK_LOG;
        if (log) {
            fs.appendFileSync(log, `${url}\n`);
            return;
        }
        const p = platform();
        if (p === 'mac') {
            await run('open', [url]);
        } else if (p === 'windows') {
            await run('rundll32', ['url.dll,FileProtocolHandler', url]);
        } else {
            await run('xdg-open', [url]);
        }
    }

    async startHandoff(input: Omit<HarmonyHandoff, 'v' | 'id' | 'source' | 'createdAt'>): Promise<{ id: string; link: string }> {
        await this.listen();
        const id = `h_${randomBytes(6).toString('hex')}`;
        const token = randomBytes(24).toString('base64url');
        const handoff: HarmonyHandoff = { ...input, v: ZAPREX_HANDOFF_VERSION, id, source: 'ingot', createdAt: Date.now() };
        this.entries.set(id, { handoff, token, status: { id, state: 'pending', updatedAt: Date.now() } });
        return { id, link: handoffDeepLink(id, this.port, token) };
    }

    async status(id: string): Promise<HandoffStatus | undefined> {
        const entry = this.entries.get(id);
        if (entry && entry.status.state === 'pending' && Date.now() - entry.handoff.createdAt > HANDOFF_CLAIM_TTL_MS) {
            entry.status = { ...entry.status, state: 'failed', message: 'Zaprex did not pick up the piece.', updatedAt: Date.now() };
        }
        return entry?.status;
    }

    async cancel(id: string): Promise<void> {
        const entry = this.entries.get(id);
        if (entry && HANDOFF_ACTIVE.includes(entry.status.state)) {
            entry.status = { ...entry.status, state: 'cancelled', updatedAt: Date.now() };
        }
    }

    protected listen(): Promise<void> {
        if (this.server) {
            return Promise.resolve();
        }
        const server = http.createServer((req, res) => void this.handle(req, res));
        this.server = server;
        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                this.port = (server.address() as AddressInfo).port;
                resolve();
            });
        });
    }

    protected send(res: http.ServerResponse, code: number, body: unknown): void {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
    }

    protected async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Browsers send Origin: refuse them outright (web mode cannot take a piece).
        if (req.headers.origin) {
            return this.send(res, 403, { error: 'Browser requests are not allowed; the Zaprex desktop app claims pieces.' });
        }
        const m = /^\/v1\/handoff\/([\w-]+)(\/status|\/result)?$/.exec((req.url ?? '').split('?')[0]);
        const entry = m && this.entries.get(m[1]);
        const auth = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
        if (!m || !entry || !auth || auth !== entry.token) {
            return this.send(res, 404, { error: 'Unknown piece or bad token.' });
        }
        const ended = !HANDOFF_ACTIVE.includes(entry.status.state);
        if (!m[2] && req.method === 'GET') {
            if (entry.status.state === 'pending' && Date.now() - entry.handoff.createdAt > HANDOFF_CLAIM_TTL_MS) {
                return this.send(res, 410, { error: 'This piece expired.' });
            }
            if (entry.status.state === 'pending') {
                entry.claimedAt = Date.now();
                entry.status = { ...entry.status, state: 'claimed', updatedAt: Date.now() };
            }
            return this.send(res, 200, entry.handoff);
        }
        if (req.method !== 'POST' || !m[2]) {
            return this.send(res, 405, { error: 'Method not allowed.' });
        }
        if (ended) {
            return this.send(res, 409, { error: `The piece is ${entry.status.state}.` });
        }
        const body = await this.readJson(req).catch((e: Error) => ({ __error: e.message }));
        if (body && typeof body === 'object' && '__error' in body) {
            return this.send(res, 400, { error: (body as { __error: string }).__error });
        }
        if (m[2] === '/status') {
            const parsed = parseStatusBody(body);
            if ('error' in parsed) {
                return this.send(res, 400, parsed);
            }
            entry.status = { ...entry.status, ...parsed, updatedAt: Date.now() };
            return this.send(res, 200, entry.status);
        }
        const result = parseResultBody(body, entry.handoff.scope);
        if ('error' in result) {
            return this.send(res, 400, result);
        }
        entry.status = { ...entry.status, state: 'done', progress: 1, result, updatedAt: Date.now() };
        return this.send(res, 200, { id: entry.handoff.id, state: 'done' });
    }

    protected readJson(req: http.IncomingMessage): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => {
                size += c.length;
                if (size > HANDOFF_MAX_BODY_BYTES) {
                    reject(new Error('Body too large.'));
                    req.destroy();
                    return;
                }
                chunks.push(c);
            });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
                } catch {
                    reject(new Error('Body is not JSON.'));
                }
            });
            req.on('error', reject);
        });
    }
}
