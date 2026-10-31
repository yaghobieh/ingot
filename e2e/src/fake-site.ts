import * as http from 'http';
import type { AddressInfo } from 'net';

export interface FakeSite {
    readonly url: string;
    close(): Promise<void>;
}

const page = (title: string, body: string): string =>
    `<!doctype html><html><head><title>${title}</title><style>body{font:15px system-ui;margin:32px;color:#1f2329}a{color:#3B6FD9}</style></head><body>${body}</body></html>`;

/** IDEA-130: a tiny shop for the agent browser e2e: a home page with a link and a GET search form, a cart, results. */
export const startFakeSite = async (): Promise<FakeSite> => {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (url.pathname === '/cart') {
            res.end(page('Cart', '<h1>Your cart</h1><p>2 items: socks, red shoes.</p><a href="/">Back to the shop</a>'));
        } else if (url.pathname === '/broken') {
            // IDEA-289: a page with an image that 404s, for the agent's failed-requests tool.
            res.end(page('Broken', '<h1>Broken page</h1><p>The logo is missing.</p><img src="/missing-logo.png" alt="Logo">'));
        } else if (url.pathname.endsWith('.png')) {
            res.statusCode = 404;
            res.setHeader('content-type', 'text/plain');
            res.end('Not found');
        } else if (url.pathname === '/search') {
            const q = (url.searchParams.get('q') ?? '').replace(/[<>&"]/g, '');
            res.end(page('Search', `<h1>Results for ${q}</h1><ul><li>${q} — 49 €</li></ul>`));
        } else {
            res.end(page('Forge Shop', '<h1>Forge Shop</h1><p>Hand-made tools.</p><a href="/cart">Cart</a>'
                + '<form action="/search" method="get"><input name="q" aria-label="Search" placeholder="Search"><button type="submit">Go</button></form>'));
        }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/`, close: () => new Promise(resolve => server.close(() => resolve())) };
};
