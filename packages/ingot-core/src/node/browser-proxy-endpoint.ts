import { injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { BROWSER_PROXY_PATH, BROWSER_STATUS_META, HTTP_ERROR_MIN, PROXY_MAX_BYTES, PROXY_TIMEOUT_MS } from '../common/browser-tool/browser-tool.consts';
import { injectBase, injectStatus, normalizeUrl } from '../common/browser-tool/browser-tool.utils';

const BAD_GATEWAY = 502;

/**
 * IDEA-130: the web build's browser panel loads pages through this route so they are same-origin with Ingot and the
 * agent can read and drive them. The response is sandboxed (no scripts run) by CSP as well as by the frame.
 */
@injectable()
export class BrowserProxyEndpoint implements BackendApplicationContribution {

    configure(app: Application): void {
        app.get(BROWSER_PROXY_PATH, (req, res) => void this.handle(req, res));
    }

    protected async handle(req: Request, res: Response): Promise<void> {
        const url = normalizeUrl(typeof req.query.url === 'string' ? req.query.url : '');
        if (!url || url === 'about:blank') {
            res.status(400).type('text/plain').send('Only http(s) URLs can be opened.');
            return;
        }
        try {
            const upstream = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PROXY_TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0 (Ingot IDE browser)', accept: 'text/html,*/*' } });
            const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
            const body = Buffer.from(await upstream.arrayBuffer()).subarray(0, PROXY_MAX_BYTES);
            res.status(upstream.status);
            res.setHeader('content-security-policy', 'sandbox allow-same-origin');
            res.setHeader('x-content-type-options', 'nosniff');
            res.setHeader('cache-control', 'no-store');
            if (/html/i.test(type)) {
                // IDEA-289: the frame cannot read the status; the page carries it for the agent's failed-requests list.
                const html = injectBase(body.toString('utf8'), upstream.url || url);
                res.type('text/html; charset=utf-8').send(upstream.status >= HTTP_ERROR_MIN ? injectStatus(html, BROWSER_STATUS_META, upstream.status) : html);
            } else {
                res.type(type).send(body);
            }
        } catch (error) {
            res.status(BAD_GATEWAY).type('text/html').send(`<!doctype html><meta name="${BROWSER_STATUS_META}" content="${BAD_GATEWAY}"><title>Could not open page</title><body style="font:13px system-ui;padding:24px">`
                + `<h3>Could not open ${url.replace(/[<>&"]/g, '')}</h3><p>${String(error instanceof Error ? error.message : error).replace(/[<>&"]/g, '')}</p></body>`);
        }
    }
}
