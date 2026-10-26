import { Emitter, type Event } from '@theia/core/lib/common/event';
import type { BrowserScreenshot } from '../../common/browser-tool/browser-tool.types';
import { BROWSER_LOAD_TIMEOUT_MS, BROWSER_PARTITION, BROWSER_SETTLE_MS } from '../../common/browser-tool/browser-tool.consts';
import { proxyUrl, unproxyUrl } from '../../common/browser-tool/browser-tool.utils';
import { serializeScript, type PageScript } from './page-scripts';

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
    readonly current: BrowserNavigation;
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

abstract class BaseEngine {
    protected readonly onDidNavigateEmitter = new Emitter<BrowserNavigation>();
    readonly onDidNavigate = this.onDidNavigateEmitter.event;
    protected state: BrowserNavigation = { url: 'about:blank', title: '', loading: false };
    protected loadWaiters: (() => void)[] = [];

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

    dispose(): void {
        this.onDidNavigateEmitter.dispose();
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
        this.element.addEventListener('did-fail-load', () => sync(false));
        this.element.addEventListener('did-navigate', () => sync(this.element.isLoading()));
        this.element.addEventListener('did-navigate-in-page', () => sync(this.element.isLoading()));
        this.element.addEventListener('page-title-updated', () => sync(this.element.isLoading()));
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

    constructor() {
        super();
        this.element = document.createElement('iframe');
        this.element.className = 'ingot-browser-page';
        this.element.setAttribute('sandbox', 'allow-same-origin');
        this.element.setAttribute('referrerpolicy', 'no-referrer');
        this.element.addEventListener('load', () => {
            const doc = this.element.contentDocument;
            const href = this.element.contentWindow?.location.href ?? 'about:blank';
            doc?.addEventListener('click', e => this.interceptClick(e), true);
            doc?.addEventListener('submit', e => e.preventDefault(), true);
            this.setState({ url: href === 'about:blank' ? href : unproxyUrl(href), title: doc?.title ?? '', loading: false });
        });
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
