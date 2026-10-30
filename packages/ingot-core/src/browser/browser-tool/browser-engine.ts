import { Emitter, type Event } from '@theia/core/lib/common/event';
import type { BrowserConsoleEntry, BrowserNetworkError, BrowserScreenshot, PageSelection } from '../../common/browser-tool/browser-tool.types';
import {
    BROWSER_LOAD_TIMEOUT_MS, BROWSER_LOG_LIMIT, BROWSER_NET_PREFIX, BROWSER_PARTITION, BROWSER_SEL_PREFIX, BROWSER_SETTLE_MS, BROWSER_STATUS_META,
    HTTP_ERROR_MIN, LOAD_ABORTED_CODE, SELECTION_DEBOUNCE_MS
} from '../../common/browser-tool/browser-tool.consts';
import { consoleLevel, parseObserverMessage, proxyUrl, pushCapped, unproxyUrl } from '../../common/browser-tool/browser-tool.utils';
import { failedAssets, installObserver, readSelection, serializeScript, type PageScript, type SelectionReport } from './page-scripts';
import { PAGE_NATIVE_KEY_CODES } from './browser-tool.browser-consts';

export interface BrowserNavigation {
    readonly url: string;
    readonly title: string;
    readonly loading: boolean;
}

/** IDEA-130: what the browser panel shows a page with. Desktop: an isolated `<webview>`; web build: a proxied, script-free frame. */
export interface BrowserEngine {
    readonly element: HTMLElement;
    /** Real pages with scripts (desktop) or a static, proxied render (web build). */
    readonly kind: 'webview' | 'frame';
    readonly onDidNavigate: Event<BrowserNavigation>;
    /** IDEA-289: the user selected text on the page (undefined: the selection was cleared). */
    readonly onDidSelect: Event<PageSelection | undefined>;
    readonly current: BrowserNavigation;
    /** IDEA-289: console messages and failed requests of the current page (cleared on each new page). */
    readonly consoleEntries: readonly BrowserConsoleEntry[];
    readonly networkErrors: readonly BrowserNetworkError[];
    navigate(url: string): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    run<A, R>(script: PageScript<A, R>, args: A): Promise<R>;
    screenshot(): Promise<BrowserScreenshot | undefined>;
    dispose(): void;
}

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Electron's `<webview>` element API (the tag is enabled for Ingot's window in the main process). */
interface WebviewTag extends HTMLElement {
    src: string;
    partition: string;
    loadURL(url: string): Promise<void>;
    getURL(): string;
    getTitle(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    isLoading(): boolean;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    capturePage(): Promise<{ toDataURL(): string; getSize(): { width: number; height: number } }>;
}

/** The webview events Ingot reads (Electron puts the fields on the DOM event). */
interface ConsoleMessageEvent extends globalThis.Event {
    readonly level: number | string;
    readonly message: string;
    readonly line?: number;
    readonly sourceId?: string;
}

interface NavigateEvent extends globalThis.Event {
    readonly url: string;
    readonly httpResponseCode?: number;
}

interface FailLoadEvent extends globalThis.Event {
    readonly errorCode: number;
    readonly errorDescription: string;
    readonly validatedURL: string;
    readonly isMainFrame: boolean;
}

abstract class BaseEngine {
    protected readonly onDidNavigateEmitter = new Emitter<BrowserNavigation>();
    readonly onDidNavigate = this.onDidNavigateEmitter.event;
    protected readonly onDidSelectEmitter = new Emitter<PageSelection | undefined>();
    readonly onDidSelect = this.onDidSelectEmitter.event;
    protected state: BrowserNavigation = { url: 'about:blank', title: '', loading: false };
    protected loadWaiters: (() => void)[] = [];
    readonly consoleEntries: BrowserConsoleEntry[] = [];
    readonly networkErrors: BrowserNetworkError[] = [];

    get current(): BrowserNavigation {
        return this.state;
    }

    protected setState(patch: Partial<BrowserNavigation>): void {
        this.state = { ...this.state, ...patch };
        this.onDidNavigateEmitter.fire(this.state);
        if (!this.state.loading) {
            this.loadWaiters.splice(0).forEach(resolve => resolve());
        }
    }

    protected waitForLoad(): Promise<void> {
        return Promise.race([new Promise<void>(resolve => this.loadWaiters.push(resolve)), delay(BROWSER_LOAD_TIMEOUT_MS)]).then(() => delay(BROWSER_SETTLE_MS));
    }

    /** A new page: its logs start empty and any selection is gone. */
    protected newPage(): void {
        this.consoleEntries.splice(0);
        this.networkErrors.splice(0);
        this.onDidSelectEmitter.fire(undefined);
    }

    protected addNetworkError(entry: Omit<BrowserNetworkError, 'at'>): void {
        pushCapped(this.networkErrors, { ...entry, at: Date.now() }, BROWSER_LOG_LIMIT);
    }

    protected select(report: SelectionReport): void {
        this.onDidSelectEmitter.fire(report.text ? { text: report.text, url: this.state.url, title: this.state.title, ...(report.rect ? { rect: report.rect } : {}) } : undefined);
    }

    dispose(): void {
        this.onDidNavigateEmitter.dispose();
        this.onDidSelectEmitter.dispose();
    }
}

export class WebviewEngine extends BaseEngine implements BrowserEngine {
    readonly kind = 'webview';
    readonly element: WebviewTag;

    /** `loadURL` needs the tag attached and its first `dom-ready`. */
    protected readonly ready: Promise<void>;

    constructor() {
        super();
        this.element = document.createElement('webview') as WebviewTag;
        this.ready = new Promise(resolve => this.element.addEventListener('dom-ready', () => resolve(), { once: true }));
        this.element.setAttribute('partition', BROWSER_PARTITION);
        this.element.setAttribute('src', 'about:blank');
        this.element.setAttribute('allowpopups', 'false');
        this.element.className = 'ingot-browser-page';
        const sync = (loading: boolean): void => {
            try {
                this.setState({ url: this.element.getURL(), title: this.element.getTitle(), loading });
            } catch {
                this.setState({ loading });
            }
        };
        this.element.addEventListener('did-start-loading', () => sync(true));
        this.element.addEventListener('did-stop-loading', () => sync(false));
        this.element.addEventListener('did-fail-load', e => {
            this.failed(e as FailLoadEvent);
            sync(false);
        });
        this.element.addEventListener('did-navigate', e => {
            this.navigated(e as NavigateEvent);
            sync(this.element.isLoading());
        });
        this.element.addEventListener('did-navigate-in-page', () => sync(this.element.isLoading()));
        this.element.addEventListener('page-title-updated', () => sync(this.element.isLoading()));
        this.element.addEventListener('console-message', e => this.consoleMessage(e as ConsoleMessageEvent));
        this.element.addEventListener('dom-ready', () => void this.observe());
    }

    protected navigated(event: NavigateEvent): void {
        this.newPage();
        if (event.httpResponseCode && event.httpResponseCode >= HTTP_ERROR_MIN) {
            this.addNetworkError({ kind: 'document', url: event.url, status: event.httpResponseCode });
        }
    }

    protected failed(event: FailLoadEvent): void {
        if (event.errorCode !== LOAD_ABORTED_CODE) {
            this.addNetworkError({ kind: event.isMainFrame ? 'document' : 'resource', url: event.validatedURL, error: event.errorDescription || String(event.errorCode) });
        }
    }

    protected consoleMessage(event: ConsoleMessageEvent): void {
        const observed = parseObserverMessage(event.message);
        if (observed?.kind === 'net') {
            this.addNetworkError(observed.entry);
        } else if (observed?.kind === 'sel') {
            this.select(observed.selection ?? { text: '' });
        } else if (!observed) {
            pushCapped(this.consoleEntries, {
                level: consoleLevel(event.level), text: event.message, at: Date.now(),
                ...(event.sourceId ? { source: event.sourceId } : {}), ...(event.line ? { line: event.line } : {})
            }, BROWSER_LOG_LIMIT);
        }
    }

    protected async observe(): Promise<void> {
        if (this.element.getURL() === 'about:blank') {
            return;
        }
        await this.run(installObserver, { netPrefix: BROWSER_NET_PREFIX, selPrefix: BROWSER_SEL_PREFIX, debounceMs: SELECTION_DEBOUNCE_MS, minStatus: HTTP_ERROR_MIN }).catch(() => undefined);
    }

    async navigate(url: string): Promise<void> {
        const loaded = this.waitForLoad();
        this.setState({ url, loading: true });
        await Promise.race([this.ready, delay(BROWSER_LOAD_TIMEOUT_MS)]);
        await this.element.loadURL(url).catch(() => undefined);
        await loaded;
    }

    async back(): Promise<void> {
        if (this.element.canGoBack()) {
            const loaded = this.waitForLoad();
            this.element.goBack();
            await loaded;
        }
    }

    async forward(): Promise<void> {
        if (this.element.canGoForward()) {
            const loaded = this.waitForLoad();
            this.element.goForward();
            await loaded;
        }
    }

    async reload(): Promise<void> {
        const loaded = this.waitForLoad();
        this.element.reload();
        await loaded;
    }

    async run<A, R>(script: PageScript<A, R>, args: A): Promise<R> {
        return await this.element.executeJavaScript(serializeScript(script, args), true) as R;
    }

    async screenshot(): Promise<BrowserScreenshot | undefined> {
        const image = await this.element.capturePage();
        const size = image.getSize();
        return { dataUrl: image.toDataURL(), width: size.width, height: size.height };
    }
}

/**
 * The web build's engine: pages load through Ingot's backend proxy into a sandboxed frame without scripts, so Ingot can
 * read and drive the DOM while the page's own code never runs next to the IDE. Links and GET forms navigate through the proxy.
 */
export class FrameEngine extends BaseEngine implements BrowserEngine {
    readonly kind = 'frame';
    readonly element: HTMLIFrameElement;
    protected history: string[] = [];
    protected index = -1;
    protected selectionTimer?: ReturnType<typeof setTimeout>;

    constructor() {
        super();
        this.element = document.createElement('iframe');
        this.element.className = 'ingot-browser-page';
        this.element.setAttribute('sandbox', 'allow-same-origin');
        this.element.setAttribute('referrerpolicy', 'no-referrer');
        this.element.addEventListener('load', () => {
            const doc = this.element.contentDocument;
            const href = this.element.contentWindow?.location.href ?? 'about:blank';
            const url = href === 'about:blank' ? href : unproxyUrl(href);
            doc?.addEventListener('click', e => this.interceptClick(e), true);
            doc?.addEventListener('submit', e => e.preventDefault(), true);
            if (doc && url !== 'about:blank') {
                this.watch(doc, url);
            }
            this.setState({ url, title: doc?.title ?? '', loading: false });
        });
    }

    /** IDEA-289: the proxy's status mark, assets that failed, and the user's selection. */
    protected watch(doc: Document, url: string): void {
        const status = Number(doc.querySelector(`meta[name="${BROWSER_STATUS_META}"]`)?.getAttribute('content'));
        if (status >= HTTP_ERROR_MIN) {
            this.addNetworkError({ kind: 'document', url, status });
        }
        failedAssets(doc, {}).forEach(asset => this.addNetworkError({ kind: 'resource', url: asset }));
        doc.addEventListener('error', e => {
            const el = e.target as (Element & { currentSrc?: string; src?: string; href?: string }) | null;
            const asset = el?.currentSrc || el?.src || el?.href;
            if (asset) {
                this.addNetworkError({ kind: 'resource', url: String(asset) });
            }
        }, true);
        const selection = (): void => {
            clearTimeout(this.selectionTimer);
            this.selectionTimer = setTimeout(() => this.select(readSelection(doc, {})), SELECTION_DEBOUNCE_MS);
        };
        doc.addEventListener('mouseup', selection, true);
        doc.addEventListener('keyup', selection, true);
        doc.defaultView?.addEventListener('scroll', selection, true);
        doc.addEventListener('keydown', e => this.forwardShortcut(e), true);
    }

    /** Keys pressed in the frame never reach Ingot; Ctrl / Cmd / Alt chords are replayed on the panel so Ingot shortcuts work (copy, paste, undo stay native). */
    protected forwardShortcut(event: KeyboardEvent): void {
        const chord = event.ctrlKey || event.metaKey || event.altKey;
        if (!chord || (!event.altKey && PAGE_NATIVE_KEY_CODES.includes(event.code))) {
            return;
        }
        const replay = new KeyboardEvent('keydown', {
            key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true
        });
        this.element.dispatchEvent(replay);
        if (replay.defaultPrevented) {
            event.preventDefault();
        }
    }

    /** The user's own clicks on links (Take control) load through the proxy too. */
    protected interceptClick(event: MouseEvent): void {
        const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (anchor && !anchor.getAttribute('href')?.startsWith('#')) {
            event.preventDefault();
            void this.navigate(anchor.href);
        }
    }

    async navigate(url: string): Promise<void> {
        this.history = [...this.history.slice(0, this.index + 1), url];
        this.index = this.history.length - 1;
        await this.load(url);
    }

    protected async load(url: string): Promise<void> {
        const loaded = this.waitForLoad();
        this.newPage();
        this.setState({ url, loading: true });
        this.element.src = url === 'about:blank' ? url : proxyUrl(url);
        await loaded;
    }

    async back(): Promise<void> {
        if (this.index > 0) {
            await this.load(this.history[--this.index]);
        }
    }

    async forward(): Promise<void> {
        if (this.index < this.history.length - 1) {
            await this.load(this.history[++this.index]);
        }
    }

    async reload(): Promise<void> {
        await this.load(this.state.url);
    }

    async run<A, R>(script: PageScript<A, R>, args: A): Promise<R> {
        const doc = this.element.contentDocument;
        if (!doc) {
            throw new Error('The page is not loaded.');
        }
        return FrameEngine.realUrls(script(doc, args));
    }

    /** Page scripts see the proxy address; the agent and the user only ever see the real one. */
    protected static realUrls<R>(result: R): R {
        if (result && typeof result === 'object') {
            const r = result as Record<string, unknown>;
            for (const key of ['url', 'navigate']) {
                if (typeof r[key] === 'string') {
                    r[key] = unproxyUrl(r[key] as string);
                }
            }
        }
        return result;
    }

    async screenshot(): Promise<BrowserScreenshot | undefined> {
        return undefined;
    }
}
