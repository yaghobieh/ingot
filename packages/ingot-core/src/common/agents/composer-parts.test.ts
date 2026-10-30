import { describe, expect, it } from 'vitest';
import { composeParts, normalizeParts, partsEmpty, partsText } from './composer-parts';
import type { ComposerPart } from './composer-parts.types';

const chip = (start: number, end: number, text: string) => ({ id: `${start}`, path: 'src/a.ts', uri: 'file:///p/src/a.ts', start, end, text });
const image = { id: 'img1', name: 'shot.png', mediaType: 'image/png', data: 'AAAA' };

describe('composer parts (IDEA-98)', () => {
    const parts: ComposerPart[] = [
        { kind: 'code', chip: chip(24, 30, 'const a = 1;\n') },
        { kind: 'text', text: ' my text ' },
        { kind: 'text', text: 'here ' },
        { kind: 'code', chip: chip(31, 34, 'const b = 2;') },
        { kind: 'text', text: ' more text' }
    ];

    it('keeps chips in order inside the visible text', () => {
        expect(composeParts(parts).text).toBe('[a.ts (24-30)] my text here [a.ts (31-34)] more text');
    });

    it('inlines each chip\'s lines where it sits for the model', () => {
        const { expanded, chips } = composeParts(parts);
        expect(chips.map(c => c.start)).toEqual([24, 31]);
        const first = expanded.indexOf('const a = 1;');
        const middle = expanded.indexOf('my text here');
        const second = expanded.indexOf('const b = 2;');
        const last = expanded.indexOf('more text');
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(middle);
        expect(middle).toBeLessThan(second);
        expect(second).toBeLessThan(last);
        expect(expanded).toContain('Selected code from src/a.ts (lines 24-30)');
    });

    it('lists images and records sent parts in order', () => {
        const composed = composeParts([{ kind: 'text', text: 'what is ' }, { kind: 'image', image }, { kind: 'text', text: '?' }]);
        expect(composed.images).toEqual([image]);
        expect(composed.text).toBe('what is [image: shot.png]?');
        expect(composed.expanded).toContain('[image 1: shot.png]');
        expect(composed.parts.map(p => p.kind)).toEqual(['text', 'image', 'text']);
    });

    it('attaches a rule chip (IDEA-287) as a rule to follow', () => {
        const rule = { id: 'r', path: '.ingot/rules/bear.md', uri: 'file:///p/.ingot/rules/bear.md', start: 1, end: 1, text: 'Use Bear.', whole: true, rule: 'bear' };
        const sent = composeParts([{ kind: 'text', text: 'build it ' }, { kind: 'code', chip: rule }]);
        expect(sent.text).toBe('build it [@bear]');
        expect(sent.expanded).toContain('Project rule bear (.ingot/rules/bear.md), follow it');
        expect(sent.expanded).toContain('Use Bear.');
    });

    it('normalizes, detects empty and reads plain text', () => {
        expect(normalizeParts([{ kind: 'text', text: 'a' }, { kind: 'text', text: '' }, { kind: 'text', text: 'b' }])).toEqual([{ kind: 'text', text: 'ab' }]);
        expect(partsEmpty([{ kind: 'text', text: '  ' }])).toBe(true);
        expect(partsEmpty([{ kind: 'image', image }])).toBe(false);
        expect(partsText([{ kind: 'text', text: '/exp' }, { kind: 'image', image }])).toBe('/exp');
    });
});
