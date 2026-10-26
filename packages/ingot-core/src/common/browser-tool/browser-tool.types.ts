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

export interface BrowserScreenshot {
    readonly dataUrl: string;
    readonly width: number;
    readonly height: number;
}
