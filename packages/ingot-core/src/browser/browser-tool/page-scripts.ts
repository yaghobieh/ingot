/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserTarget, PageActionResult, PageSnapshot } from '../../common/browser-tool/browser-tool.types';

/**
 * IDEA-130: scripts that run against the page's document. Each is self-contained (no imports or closures) because the
 * desktop engine serializes it into the page with `executeJavaScript`; the web engine calls it with the frame's document.
 */
export type PageScript<A, R> = (doc: Document, args: A) => R;

export const snapshotPage: PageScript<{ maxText: number; maxElements: number }, PageSnapshot> = (doc, args) => {
    const win = doc.defaultView as any;
    const selector = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=""],[contenteditable=true]';
    doc.querySelectorAll('[data-ingot-ref]').forEach(e => e.removeAttribute('data-ingot-ref'));
    const elements: any[] = [];
    let ref = 0;
    for (const el of Array.from(doc.querySelectorAll(selector)) as any[]) {
        const rect = el.getBoundingClientRect();
        const style = win.getComputedStyle(el);
        if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none' || el.disabled) {
            continue;
        }
        if (elements.length >= args.maxElements) {
            break;
        }
        ref++;
        el.setAttribute('data-ingot-ref', String(ref));
        const tag = el.tagName.toLowerCase();
        const labelFor = el.id ? doc.querySelector(`label[for="${el.id.replace(/"/g, '\\"')}"]`) : null;
        const label = String(el.getAttribute('aria-label') || (labelFor && labelFor.textContent) || el.innerText || el.placeholder
            || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
        elements.push({
            ref, tag, label,
            ...(el.getAttribute('role') ? { role: el.getAttribute('role') } : {}),
            ...(tag === 'a' && el.href ? { href: String(el.href) } : {}),
            ...(tag === 'input' ? { type: String(el.type || 'text') } : {}),
            ...(isField && el.type !== 'password' && el.value ? { value: String(el.value).slice(0, 80) } : {})
        });
    }
    const raw = String((doc.body && doc.body.innerText) || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
        url: String(doc.location && doc.location.href), title: doc.title, text: raw.slice(0, args.maxText), textCut: raw.length > args.maxText, elements,
        scrollY: Math.round(win.scrollY || 0), scrollHeight: Math.round(doc.documentElement.scrollHeight), viewportHeight: Math.round(win.innerHeight)
    };
};

/** Finds a target by ref (from the last read), CSS selector or visible text, and clicks it. */
export const clickTarget: PageScript<{ target: BrowserTarget; followLinks: boolean }, PageActionResult> = (doc, args) => {
    const t = args.target;
    let el: any = null;
    if (t.ref !== undefined) {
        el = doc.querySelector(`[data-ingot-ref="${t.ref}"]`);
    }
    if (!el && t.selector) {
        try { el = doc.querySelector(t.selector); } catch { return { ok: false, message: `Invalid selector ${t.selector}` }; }
    }
    if (!el && t.text) {
        const want = t.text.toLowerCase();
        const candidates = Array.from(doc.querySelectorAll('a,button,input[type=submit],input[type=button],summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]')) as any[];
        const textOf = (c: any): string => String(c.getAttribute('aria-label') || c.innerText || c.value || c.getAttribute('title') || '').replace(/\s+/g, ' ').trim().toLowerCase();
        el = candidates.find(c => textOf(c) === want) || candidates.find(c => textOf(c).includes(want)) || null;
    }
    if (!el) {
        return { ok: false, message: 'No element matches. Read the page again (ingot/browser_read) for fresh refs.' };
    }
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const name = String(el.getAttribute('aria-label') || el.innerText || el.value || el.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 60);
    const anchor = el.closest ? el.closest('a[href]') : null;
    if (anchor && args.followLinks && !String(anchor.getAttribute('href')).startsWith('#')) {
        return { ok: true, message: `Clicked "${name}".`, navigate: String(anchor.href) };
    }
    const form = args.followLinks && el.form && (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type'))) ? el.form : null;
    if (form && String(form.method || 'get').toLowerCase() === 'get') {
        const win = doc.defaultView as any;
        const url = new win.URL(form.getAttribute('action') || '', doc.baseURI);
        url.search = new win.URLSearchParams(new win.FormData(form)).toString();
        return { ok: true, message: `Clicked "${name}" and submitted the form.`, navigate: url.toString() };
    }
    if (typeof el.focus === 'function') {
        el.focus();
    }
    el.click();
    return { ok: true, message: `Clicked "${name}".` };
};

/** Types into an input, textarea or contenteditable (React-friendly: native setter + input/change events); optional submit. */
export const typeInto: PageScript<{ target: BrowserTarget; text: string; submit: boolean; followLinks: boolean }, PageActionResult> = (doc, args) => {
    const t = args.target;
    const win = doc.defaultView as any;
    let el: any = null;
    if (t.ref !== undefined) {
        el = doc.querySelector(`[data-ingot-ref="${t.ref}"]`);
    }
    if (!el && t.selector) {
        try { el = doc.querySelector(t.selector); } catch { return { ok: false, message: `Invalid selector ${t.selector}` }; }
    }
    if (!el && t.text) {
        const want = t.text.toLowerCase();
        const fields = Array.from(doc.querySelectorAll('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable=true]')) as any[];
        const labelOf = (f: any): string => {
            const byFor = f.id ? doc.querySelector(`label[for="${f.id.replace(/"/g, '\\"')}"]`) : null;
            return String(f.getAttribute('aria-label') || (byFor && byFor.textContent) || f.placeholder || f.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
        };
        el = fields.find(f => labelOf(f) === want) || fields.find(f => labelOf(f).includes(want)) || null;
    }
    if (!el && !t.ref && !t.selector && !t.text) {
        el = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.querySelector('input:not([type=hidden]),textarea');
    }
    if (!el) {
        return { ok: false, message: 'No field matches. Read the page again (ingot/browser_read) for fresh refs.' };
    }
    el.scrollIntoView({ block: 'center' });
    if (typeof el.focus === 'function') {
        el.focus();
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
        const proto = tag === 'input' ? win.HTMLInputElement.prototype : win.HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) {
            setter.set.call(el, args.text);
        } else {
            el.value = args.text;
        }
    } else {
        el.textContent = args.text;
    }
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    if (!args.submit) {
        return { ok: true, message: `Typed into ${tag}.` };
    }
    for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new win.KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    const form = el.form || (el.closest && el.closest('form'));
    if (form) {
        if (args.followLinks && String(form.method || 'get').toLowerCase() === 'get') {
            const url = new win.URL(form.getAttribute('action') || '', doc.baseURI);
            url.search = new win.URLSearchParams(new win.FormData(form)).toString();
            return { ok: true, message: `Typed into ${tag} and submitted.`, navigate: url.toString() };
        }
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
        } else {
            form.submit();
        }
    }
    return { ok: true, message: `Typed into ${tag} and pressed Enter.` };
};

export const scrollPage: PageScript<{ direction: 'up' | 'down' | 'top' | 'bottom' }, PageActionResult> = (doc, args) => {
    const win = doc.defaultView as any;
    const h = win.innerHeight * 0.85;
    if (args.direction === 'top') {
        win.scrollTo(0, 0);
    } else if (args.direction === 'bottom') {
        win.scrollTo(0, doc.documentElement.scrollHeight);
    } else {
        win.scrollBy(0, args.direction === 'up' ? -h : h);
    }
    return { ok: true, message: `Scrolled ${args.direction}.` };
};

export interface SelectionReport {
    readonly text: string;
    readonly rect?: { left: number; top: number; bottom: number; width: number };
}

/** IDEA-289: the selected text and its box in the page's viewport (the web build's frame calls it after mouseup / keyup). */
export const readSelection: PageScript<Record<string, never>, SelectionReport> = doc => {
    const win = doc.defaultView as any;
    const sel = win && win.getSelection ? win.getSelection() : null;
    const text = sel ? String(sel.toString()).trim() : '';
    if (!text || !sel.rangeCount) {
        return { text: '' };
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return { text, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } };
};

export interface ObserverArgs {
    readonly netPrefix: string;
    readonly selPrefix: string;
    readonly debounceMs: number;
    readonly minStatus: number;
}

/**
 * IDEA-289: installed in desktop pages on dom-ready. Reports failed assets, fetch and XHR calls (HTTP errors and no
 * response) and the user's text selection as prefixed `console.debug` lines, which the panel reads from the webview's
 * console-message event and never shows as page logs. Runs once per document.
 */
export const installObserver: PageScript<ObserverArgs, boolean> = (doc, args) => {
    const win = doc.defaultView as any;
    if (!win || win.__ingotObserver) {
        return false;
    }
    win.__ingotObserver = true;
    const debug = win.console.debug.bind(win.console);
    const abs = (url: any): string => { try { return new win.URL(String(url), doc.baseURI).href; } catch { return String(url); } };
    const report = (entry: Record<string, unknown>): void => { try { debug(args.netPrefix + JSON.stringify(entry)); } catch { /* page replaced console */ } };
    const statusOf = (url: string): number | undefined => {
        const entries = win.performance && win.performance.getEntriesByName ? win.performance.getEntriesByName(url) : [];
        const last = entries[entries.length - 1];
        return last && last.responseStatus ? last.responseStatus : undefined;
    };
    doc.addEventListener('error', (event: any) => {
        const el = event.target;
        const url = el && el !== win && (el.currentSrc || el.src || el.href);
        if (url) {
            report({ kind: 'resource', url: String(url), status: statusOf(String(url)) });
        }
    }, true);
    for (const img of Array.from(doc.images) as any[]) {
        const url = img.currentSrc || img.src;
        if (url && img.complete && img.naturalWidth === 0) {
            report({ kind: 'resource', url: String(url), status: statusOf(String(url)) });
        }
    }
    const fetchFn = win.fetch;
    if (typeof fetchFn === 'function') {
        win.fetch = function (this: any, ...params: any[]) {
            const [input, init] = params;
            const url = abs(input && typeof input === 'object' && input.url ? input.url : input);
            const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET');
            return fetchFn.apply(this, params).then((res: any) => {
                if (res.status >= args.minStatus) {
                    report({ kind: 'fetch', url: res.url || url, method, status: res.status });
                }
                return res;
            }, (error: any) => {
                report({ kind: 'fetch', url, method, error: String((error && error.message) || error) });
                throw error;
            });
        };
    }
    const xhr = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (xhr) {
        const open = xhr.open;
        const send = xhr.send;
        xhr.open = function (this: any, ...params: any[]) {
            this.__ingot = { method: String(params[0]), url: abs(params[1]) };
            return open.apply(this, params);
        };
        xhr.send = function (this: any, ...params: any[]) {
            const info = this.__ingot;
            if (info) {
                this.addEventListener('loadend', () => {
                    if (this.status >= args.minStatus) {
                        report({ kind: 'xhr', ...info, status: this.status });
                    } else if (this.status === 0) {
                        report({ kind: 'xhr', ...info, error: 'no response' });
                    }
                });
            }
            return send.apply(this, params);
        };
    }
    let timer: any;
    const selection = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const sel = win.getSelection();
            const text = sel ? String(sel.toString()).trim() : '';
            const r = text && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : undefined;
            debug(args.selPrefix + JSON.stringify({ text, rect: r ? { left: r.left, top: r.top, bottom: r.bottom, width: r.width } : undefined }));
        }, args.debounceMs);
    };
    doc.addEventListener('mouseup', selection, true);
    doc.addEventListener('keyup', selection, true);
    win.addEventListener('scroll', selection, true);
    return true;
};

/** IDEA-289: assets that already failed when the web build's frame finished loading (their error events fired earlier). */
export const failedAssets: PageScript<Record<string, never>, string[]> = doc => {
    const images = (Array.from(doc.images) as any[]).filter(img => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src)).map(img => String(img.currentSrc || img.src));
    const sheets = (Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]')) as any[]).filter(link => !link.sheet).map(link => String(link.href));
    return [...images, ...sheets];
};

/** Source for the desktop engine: `(fn)(document, args)`. */
export const serializeScript = <A, R>(script: PageScript<A, R>, args: A): string => `(${script.toString()})(document, ${JSON.stringify(args)})`;
