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

/** Source for the desktop engine: `(fn)(document, args)`. */
export const serializeScript = <A, R>(script: PageScript<A, R>, args: A): string => `(${script.toString()})(document, ${JSON.stringify(args)})`;
