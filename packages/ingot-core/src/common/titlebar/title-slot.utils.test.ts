import { describe, expect, it } from 'vitest';
import { computeTitleSlot } from './title-slot.utils';

describe('computeTitleSlot', () => {
    it('centres the title in the window when the gap allows it', () => {
        expect(computeTitleSlot({ leftEdge: 400, rightEdge: 1200, panelWidth: 1600, titleWidth: 200 })).toEqual({ hidden: false, left: 700, maxWidth: 768 });
    });
    it('centres it in the free gap when window-centring would cover a toolbar button', () => {
        const slot = computeTitleSlot({ leftEdge: 700, rightEdge: 1200, panelWidth: 1600, titleWidth: 200 });
        expect(slot.hidden).toBe(false);
        expect(slot.left).toBe(850);
        expect(slot.left).toBeGreaterThanOrEqual(716);
        expect(slot.left + 200).toBeLessThanOrEqual(1184);
    });
    it('ellipsizes a title wider than the gap', () => {
        const slot = computeTitleSlot({ leftEdge: 400, rightEdge: 700, panelWidth: 1000, titleWidth: 500 });
        expect(slot).toEqual({ hidden: false, left: 416, maxWidth: 268 });
    });
    it('hides the title when there is no useful room (small window)', () => {
        expect(computeTitleSlot({ leftEdge: 520, rightEdge: 560, panelWidth: 960, titleWidth: 160 }).hidden).toBe(true);
    });
    it('hides it when the toolbar groups already overlap', () => {
        expect(computeTitleSlot({ leftEdge: 600, rightEdge: 500, panelWidth: 960, titleWidth: 160 }).hidden).toBe(true);
    });
});
