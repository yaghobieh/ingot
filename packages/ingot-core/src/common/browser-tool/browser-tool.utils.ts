import type { BrowserTarget, PageSnapshot } from './browser-tool.types';
import { BROWSER_PROXY_PATH } from './browser-tool.consts';

/** "example.com" → "https://example.com/"; "localhost:5173" → "http://localhost:5173/"; only http(s) and about:blank pass. */
export const normalizeUrl = (input: string): string | undefined => {
    const raw = input.trim();
    if (!raw) {
        return undefined;
    }
    if (raw === 'about:blank') {
        return raw;
    }
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(raw);
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${local ? 'http' : 'https'}://${raw}`;
    try {
        const url = new URL(withScheme);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
};

/** The proxied URL the web build loads in its frame. */
export const proxyUrl = (url: string): string => `${BROWSER_PROXY_PATH}?url=${encodeURIComponent(url)}`;

/** The real URL behind a proxied frame URL. */
export const unproxyUrl = (href: string): string => {
    try {
        const url = new URL(href, 'http://ingot.local');
        return url.pathname === BROWSER_PROXY_PATH ? url.searchParams.get('url') ?? href : href;
    } catch {
        return href;
    }
};

/** How a target reads on the approval card: "Sign in", "#email", "[3]". */
export const describeTarget = (target: BrowserTarget): string =>
    target.text ? `"${target.text}"` : target.selector ? target.selector : target.ref !== undefined ? `[${target.ref}]` : 'the page';

/**
 * The element a tool call points at. `browser_click` takes {ref | selector | text}; `browser_type` takes
 * {ref | selector | label} because its `text` is what to type.
 */
export const toTarget = (args: Record<string, unknown>, tool: 'click' | 'type'): BrowserTarget => {
    const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
    const ref = typeof args.ref === 'number' ? args.ref : /^\d+$/.test(str(args.ref)) ? Number(str(args.ref)) : undefined;
    const text = str(tool === 'click' ? args.text : args.label);
    return { ...(ref !== undefined ? { ref } : {}), ...(str(args.selector) ? { selector: str(args.selector) } : {}), ...(text ? { text } : {}) };
};

/** The page as the agent reads it: title, URL, interactive elements with refs, then the visible text. */
export const formatSnapshot = (page: PageSnapshot): string => {
    const lines = [`${page.title || '(no title)'} — ${page.url}`];
    if (page.scrollHeight > page.viewportHeight) {
        const pct = Math.round((page.scrollY / Math.max(1, page.scrollHeight - page.viewportHeight)) * 100);
        lines.push(`Scrolled ${Math.min(100, Math.max(0, pct))}% (page is ${Math.round(page.scrollHeight / Math.max(1, page.viewportHeight) * 10) / 10} screens tall).`);
    }
    if (page.elements.length) {
        lines.push('', 'Interactive elements (use "ref" with ingot/browser_click or ingot/browser_type):');
        for (const e of page.elements) {
            const kind = e.type ? `${e.tag}[${e.type}]` : e.role ? `${e.tag}(${e.role})` : e.tag;
            lines.push(`[${e.ref}] ${kind} ${e.label ? `"${e.label}"` : ''}${e.value ? ` value="${e.value}"` : ''}${e.href ? ` → ${e.href}` : ''}`.trimEnd());
        }
    }
    lines.push('', 'Text:', page.text || '(empty)');
    if (page.textCut) {
        lines.push('… (text cut; scroll and read again for more)');
    }
    return lines.join('\n');
};

/** Builds the URL a GET form submits to. */
export const formGetUrl = (action: string, fields: readonly (readonly [string, string])[]): string => {
    const url = new URL(action);
    url.search = new URLSearchParams(fields as [string, string][]).toString();
    return url.toString();
};

/** Injects `<base href>` so a proxied page loads its links and assets from the real site. */
export const injectBase = (html: string, url: string): string => {
    const base = `<base href="${url.replace(/"/g, '&quot;')}">`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}${base}`) : `${base}${html}`;
};
