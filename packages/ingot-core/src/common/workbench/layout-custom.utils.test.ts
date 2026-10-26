import { describe, expect, it } from 'vitest';
import { applyOrder, reorderIds, toggleFit, workspaceKey } from './layout-custom.utils';

describe('IDEA-127 layout helpers', () => {
    it('reorders ids by drag source and drop target', () => {
        expect(reorderIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
        expect(reorderIds(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
        expect(reorderIds(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
    });

    it('applies a saved order, keeping new items at the end and dropping unknown ids', () => {
        const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'new' }];
        expect(applyOrder(items, ['c', 'gone', 'a', 'b']).map(i => i.id)).toEqual(['c', 'a', 'b', 'new']);
        expect(applyOrder(items, undefined).map(i => i.id)).toEqual(['a', 'b', 'c', 'new']);
    });

    it('fits to content within 60% of the window, then restores', () => {
        const first = toggleFit(250, 420, 1440, {});
        expect(first.size).toBe(444);
        expect(first.state.previous).toBe(250);
        expect(toggleFit(first.size, 420, 1440, first.state)).toEqual({ size: 250, state: {} });
        expect(toggleFit(250, 5000, 1000, {}).size).toBe(600);
        expect(toggleFit(250, 10, 1000, {}).size).toBe(160);
    });

    it('scopes a storage key to the workspace', () => {
        expect(workspaceKey('k', 'file:///a')).toBe('k:file:///a');
        expect(workspaceKey('k', 'file:///a')).not.toBe(workspaceKey('k', 'file:///b'));
        expect(workspaceKey('k', undefined)).toBe('k:');
    });
});
