import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from '@theia/core/shared/react-dom/server';
import { describe, expect, it } from 'vitest';
import { RexMark } from './rex-mark';
import { REX_MARK_DEFAULT_SIZE, REX_MARK_LEFT, REX_MARK_RIGHT } from './rex-mark.consts';

const render = (props: Parameters<typeof RexMark>[0] = {}): string => renderToStaticMarkup(React.createElement(RexMark, props));

describe('Rex mark', () => {
    it('is the </> glyph alone: brackets and slash, no tile, box or background behind it', () => {
        const svg = render();
        expect(svg).toContain(`d="${REX_MARK_LEFT}"`);
        expect(svg).toContain(`d="${REX_MARK_RIGHT}"`);
        expect(svg).toContain('<line');
        for (const tile of ['<rect', '<circle', '<polygon', 'fill="#', 'background']) {
            expect(svg).not.toContain(tile);
        }
    });

    it('takes its colors from the --ingot-rex-* tokens (no hard-coded hex)', () => {
        const svg = render();
        expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        for (const part of ['ingot-rex-glow', 'ingot-rex-edge', 'ingot-rex-stop-light', 'ingot-rex-stop-mid', 'ingot-rex-stop-deep']) {
            expect(svg).toContain(part);
        }
    });

    it('is decorative by default and named when labelled', () => {
        expect(render()).toContain('aria-hidden="true"');
        const named = render({ label: 'Ingot agent' });
        expect(named).toContain('role="img"');
        expect(named).toContain('aria-label="Ingot agent"');
        expect(named).not.toContain('aria-hidden');
    });

    it('sizes and classes like other icons', () => {
        expect(render()).toContain(`width="${REX_MARK_DEFAULT_SIZE}"`);
        const big = render({ size: 18, className: 'ingot-agent-mark' });
        expect(big).toContain('width="18"');
        expect(big).toContain('class="ingot-rex-mark ingot-agent-mark"');
    });

    it('keeps gradient and glow ids unique per instance', () => {
        const ids = (svg: string) => [...svg.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
        const first = ids(render());
        const second = ids(render());
        expect(first).toHaveLength(2);
        expect(first.filter(id => second.includes(id))).toEqual([]);
    });
});
