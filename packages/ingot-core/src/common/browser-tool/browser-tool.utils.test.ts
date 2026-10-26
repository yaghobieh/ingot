import { describe, expect, it } from 'vitest';
import { describeTarget, formatSnapshot, formGetUrl, injectBase, normalizeUrl, proxyUrl, toTarget, unproxyUrl } from './browser-tool.utils';

describe('IDEA-130 browser tool helpers', () => {
    it('normalizes URLs and refuses other schemes', () => {
        expect(normalizeUrl('example.com')).toBe('https://example.com/');
        expect(normalizeUrl('localhost:5173/app')).toBe('http://localhost:5173/app');
        expect(normalizeUrl('http://a.test/x?y=1')).toBe('http://a.test/x?y=1');
        expect(normalizeUrl('file:///etc/passwd')).toBeUndefined();
        expect(normalizeUrl('javascript:alert(1)')).toBeUndefined();
        expect(normalizeUrl('about:blank')).toBe('about:blank');
        expect(normalizeUrl('  ')).toBeUndefined();
    });
    it('round-trips proxied URLs', () => {
        const proxied = proxyUrl('https://a.test/?q=1&b=2');
        expect(proxied).toBe('/ingot-browser/proxy?url=https%3A%2F%2Fa.test%2F%3Fq%3D1%26b%3D2');
        expect(unproxyUrl(`http://127.0.0.1:3000${proxied}`)).toBe('https://a.test/?q=1&b=2');
        expect(unproxyUrl('https://b.test/')).toBe('https://b.test/');
    });
    it('reads targets from tool arguments', () => {
        expect(toTarget({ ref: 3 }, 'click')).toEqual({ ref: 3 });
        expect(toTarget({ ref: '4' }, 'click')).toEqual({ ref: 4 });
        expect(toTarget({ selector: ' #email ' }, 'type')).toEqual({ selector: '#email' });
        expect(toTarget({ text: 'Sign in' }, 'click')).toEqual({ text: 'Sign in' });
        expect(toTarget({ selector: '#q', text: 'hello' }, 'type')).toEqual({ selector: '#q' });
        expect(toTarget({ label: 'Email', text: 'a@b.c' }, 'type')).toEqual({ text: 'Email' });
        expect(describeTarget({ text: 'Sign in' })).toBe('"Sign in"');
        expect(describeTarget({ ref: 2 })).toBe('[2]');
    });
    it('formats a page for the agent', () => {
        const text = formatSnapshot({
            url: 'http://a.test/', title: 'Shop', text: 'Welcome', textCut: true, scrollY: 0, scrollHeight: 2000, viewportHeight: 1000,
            elements: [{ ref: 1, tag: 'a', label: 'Cart', href: 'http://a.test/cart' }, { ref: 2, tag: 'input', type: 'search', label: 'Search', value: 'shoes' }]
        });
        expect(text).toContain('Shop — http://a.test/');
        expect(text).toContain('Scrolled 0% (page is 2 screens tall).');
        expect(text).toContain('[1] a "Cart" → http://a.test/cart');
        expect(text).toContain('[2] input[search] "Search" value="shoes"');
        expect(text).toContain('… (text cut');
    });
    it('builds GET form URLs and injects a base href', () => {
        expect(formGetUrl('https://a.test/search?old=1', [['q', 'red shoes'], ['page', '2']])).toBe('https://a.test/search?q=red+shoes&page=2');
        expect(injectBase('<html><head><title>x</title></head></html>', 'https://a.test/p')).toBe('<html><head><base href="https://a.test/p"><title>x</title></head></html>');
        expect(injectBase('<p>x</p>', 'https://a.test/')).toBe('<base href="https://a.test/"><p>x</p>');
    });
});
