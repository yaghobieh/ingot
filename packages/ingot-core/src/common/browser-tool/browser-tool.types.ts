/** IDEA-130: the agent's browser (an Ingot panel the agent drives; the user can take control). */
export type BrowserControl = 'agent' | 'user';

/** A target on the page: a ref from the last page read, a CSS selector, or visible text. */
export interface BrowserTarget {
    readonly ref?: number;
    readonly selector?: string;
    readonly text?: string;
}

export interface PageElement {
    readonly ref: number;
    readonly tag: string;
    readonly role?: string;
    readonly label: string;
    readonly href?: string;
    readonly type?: string;
    readonly value?: string;
}

export interface PageSnapshot {
    readonly url: string;
    readonly title: string;
    readonly text: string;
    readonly textCut: boolean;
    readonly elements: readonly PageElement[];
    readonly scrollY: number;
    readonly scrollHeight: number;
    readonly viewportHeight: number;
}

/** What a page action did; `navigate` asks the frame engine to load a link through the proxy. */
export interface PageActionResult {
    readonly ok: boolean;
    readonly message: string;
    readonly navigate?: string;
}

/** IDEA-289: a console message from the page (desktop app; the web build's frame runs no page scripts). */
export type BrowserConsoleLevel = 'debug' | 'info' | 'warning' | 'error';

export interface BrowserConsoleEntry {
    readonly level: BrowserConsoleLevel;
    readonly text: string;
    /** Script URL and line, when the page reported them. */
    readonly source?: string;
    readonly line?: number;
    readonly at: number;
}

/** What failed: the page itself, an asset (img, script, css), or a fetch / XHR call. */
export type BrowserRequestKind = 'document' | 'resource' | 'fetch' | 'xhr';

export interface BrowserNetworkError {
    readonly kind: BrowserRequestKind;
    readonly url: string;
    readonly method?: string;
    /** HTTP status (>= 400); absent when the request never got a response. */
    readonly status?: number;
    /** Why it failed without a response, e.g. "net::ERR_NAME_NOT_RESOLVED". */
    readonly error?: string;
    readonly at: number;
}

/** Text the user selected on the page, with where it sits in the panel (CSS px from the page's top left). */
export interface PageSelection {
    readonly text: string;
    readonly url: string;
    readonly title: string;
    readonly rect?: { readonly left: number; readonly top: number; readonly bottom: number; readonly width: number };
}

export interface BrowserScreenshot {
    readonly dataUrl: string;
    readonly width: number;
    readonly height: number;
}
