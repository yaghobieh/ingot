import type { BrowserConsoleEntry, BrowserConsoleLevel, BrowserNetworkError, BrowserTarget, PageSelection, PageSnapshot } from './browser-tool.types';
import {
    BROWSER_LOG_REPORT, BROWSER_LOG_TEXT_CHARS, BROWSER_NET_PREFIX, BROWSER_PROXY_PATH, BROWSER_RUN_COMMAND, BROWSER_SEL_PREFIX,
    SELECTION_POPOVER_GAP_PX, SELECTION_POPOVER_WIDTH_PX, SELECTION_QUOTE_CHARS
} from './browser-tool.consts';

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

/** IDEA-289: injects `<meta name="…" content="<status>">` so the frame engine can report the page's HTTP error. */
export const injectStatus = (html: string, name: string, status: number): string => {
    const meta = `<meta name="${name}" content="${status}">`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}${meta}`) : `${meta}${html}`;
};

const CONSOLE_LEVELS: Record<string, BrowserConsoleLevel> = {
    0: 'debug', 1: 'info', 2: 'warning', 3: 'error',
    verbose: 'debug', debug: 'debug', log: 'info', info: 'info', warn: 'warning', warning: 'warning', error: 'error'
};

/** Electron's console-message level: a number (0-3) in older releases, a name in newer ones. */
export const consoleLevel = (raw: unknown): BrowserConsoleLevel => CONSOLE_LEVELS[String(raw).toLowerCase()] ?? 'info';

/** Appends and keeps only the latest `limit` items. */
export const pushCapped = <T>(list: T[], item: T, limit: number): void => {
    list.push(item);
    if (list.length > limit) {
        list.splice(0, list.length - limit);
    }
};

export type ObserverMessage =
    | { readonly kind: 'net'; readonly entry: Omit<BrowserNetworkError, 'at'> }
    | { readonly kind: 'sel'; readonly selection?: Pick<PageSelection, 'text' | 'rect'> };

/** A console line from Ingot's desktop page observer (failed request or selection); undefined for real page logs. */
export const parseObserverMessage = (text: string): ObserverMessage | undefined => {
    const prefix = text.startsWith(BROWSER_NET_PREFIX) ? BROWSER_NET_PREFIX : text.startsWith(BROWSER_SEL_PREFIX) ? BROWSER_SEL_PREFIX : undefined;
    if (!prefix) {
        return undefined;
    }
    let data: Record<string, unknown>;
    try {
        data = JSON.parse(text.slice(prefix.length)) as Record<string, unknown>;
    } catch {
        return undefined;
    }
    if (prefix === BROWSER_SEL_PREFIX) {
        const selected = typeof data.text === 'string' ? data.text.trim() : '';
        const r = data.rect as Record<string, unknown> | undefined;
        const rect = r && [r.left, r.top, r.bottom, r.width].every(v => typeof v === 'number')
            ? { left: r.left as number, top: r.top as number, bottom: r.bottom as number, width: r.width as number } : undefined;
        return { kind: 'sel', ...(selected ? { selection: { text: selected, ...(rect ? { rect } : {}) } } : {}) };
    }
    const kind = data.kind === 'document' || data.kind === 'fetch' || data.kind === 'xhr' ? data.kind : 'resource';
    if (typeof data.url !== 'string' || !data.url) {
        return undefined;
    }
    return {
        kind: 'net', entry: {
            kind, url: data.url,
            ...(typeof data.method === 'string' ? { method: data.method.toUpperCase() } : {}),
            ...(typeof data.status === 'number' && data.status > 0 ? { status: data.status } : {}),
            ...(typeof data.error === 'string' && data.error ? { error: data.error } : {})
        }
    };
};

export type ConsoleFilter = 'error' | 'warning' | 'all';

const LEVEL_RANK: Record<BrowserConsoleLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };
const FILTER_MIN: Record<ConsoleFilter, number> = { all: 0, warning: 2, error: 3 };

export const consoleFilter = (raw: unknown): ConsoleFilter => raw === 'error' || raw === 'warning' ? raw : 'all';

const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max)}…` : text;

/** The page's console for the agent: latest entries first filtered by level, oldest to newest. */
export const formatConsole = (entries: readonly BrowserConsoleEntry[], filter: ConsoleFilter, pageUrl: string): string => {
    const shown = entries.filter(e => LEVEL_RANK[e.level] >= FILTER_MIN[filter]).slice(-BROWSER_LOG_REPORT);
    const s = shown.length === 1 ? '' : 's';
    const what = filter === 'all' ? `console message${s}` : filter === 'error' ? `console error${s}` : `console warning${s} or error${s}`;
    if (!shown.length) {
        return `No ${what} on ${pageUrl}.`;
    }
    const lines = shown.map(e => {
        const where = e.source ? ` (${e.source}${e.line ? `:${e.line}` : ''})` : '';
        return `[${e.level}] ${clip(e.text.replace(/\s+/g, ' ').trim(), BROWSER_LOG_TEXT_CHARS)}${where}`;
    });
    return [`${shown.length} ${what} on ${pageUrl}:`, ...lines].join('\n');
};

/** Failed requests for the agent: HTTP errors and requests that got no response. */
export const formatNetworkErrors = (entries: readonly BrowserNetworkError[], pageUrl: string): string => {
    const shown = entries.slice(-BROWSER_LOG_REPORT);
    if (!shown.length) {
        return `No failed requests on ${pageUrl}.`;
    }
    const lines = shown.map(e => `${e.status ?? e.error ?? 'failed'} ${e.method ?? 'GET'} ${e.url} (${e.kind})`);
    return [`${shown.length} failed ${shown.length === 1 ? 'request' : 'requests'} on ${pageUrl}:`, ...lines].join('\n');
};

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const pageName = (s: Pick<PageSelection, 'url' | 'title'>): string => s.title && s.title !== s.url ? `${s.title} (${s.url})` : s.url;

/** IDEA-289: "Quote in chat" puts one line in the composer: where it is from and the selected text. */
export const quoteForComposer = (s: PageSelection): string => `From ${pageName(s)}: "${clip(flat(s.text), SELECTION_QUOTE_CHARS)}"`;

/** IDEA-289: "Comment" sends the selection as a quote block with the user's note under it. */
export const commentMessage = (s: PageSelection, comment: string): string => {
    const quoted = clip(s.text.trim(), SELECTION_QUOTE_CHARS).split(/\r?\n/).map(line => `> ${line}`).join('\n');
    return `Comment on ${pageName(s)}:\n${quoted}\n\n${comment.trim()}`;
};

/** Where the Quote / Comment bar sits: under the selection, kept inside the panel (above it when there is no room). */
export const popoverPosition = (rect: NonNullable<PageSelection['rect']>, hostWidth: number, hostHeight: number, barHeight: number): { left: number; top: number } => {
    const width = Math.min(SELECTION_POPOVER_WIDTH_PX, hostWidth);
    const left = Math.max(0, Math.min(rect.left + rect.width / 2 - width / 2, hostWidth - width));
    const below = rect.bottom + SELECTION_POPOVER_GAP_PX;
    const top = below + barHeight <= hostHeight ? below : Math.max(0, rect.top - SELECTION_POPOVER_GAP_PX - barHeight);
    return { left: Math.round(left), top: Math.round(top) };
};

const RUN_COMMAND = new RegExp(`^/${BROWSER_RUN_COMMAND}(?:\\s+|$)`);

/** IDEA-289: the task after a leading `/browser`, or undefined when the message does not start with it. */
export const browserRunTask = (prompt: string): string | undefined => {
    const text = prompt.trimStart();
    return RUN_COMMAND.test(text) ? text.replace(RUN_COMMAND, '').trim() : undefined;
};
