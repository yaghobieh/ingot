import { describe, expect, it } from 'vitest';
import { capOutput, htmlToText, parseSearchResults } from './agent-actions-service';

describe('IDEA-109 agent actions service helpers', () => {
    it('turns HTML into readable text', () => {
        expect(htmlToText('<html><style>x{}</style><script>alert(1)</script><h1>Title</h1><p>A &amp; B</p></html>')).toBe('Title\n A & B');
    });
    it('parses search results and unwraps redirect links', () => {
        const html = '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmantine.dev%2F&amp;rut=x">Mantine <b>UI</b></a>'
            + '<a class="result__a" href="https://example.com/b">B</a>';
        expect(parseSearchResults(html)).toEqual([{ title: 'Mantine UI', url: 'https://mantine.dev/' }, { title: 'B', url: 'https://example.com/b' }]);
    });
    it('caps long output', () => {
        expect(capOutput('abcdef', 3)).toBe('abc\n… (3 more characters cut)');
    });
});
