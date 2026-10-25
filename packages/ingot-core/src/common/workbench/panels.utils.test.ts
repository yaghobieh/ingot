import { describe, expect, it } from 'vitest';
import { PANELS } from './panels.consts';
import { panelCommandId, panelOwnsWidget, panelsForBar } from './panels.utils';

describe('panel toggles (IDEA-119)', () => {
    const terminal = PANELS.find(p => p.id === 'terminal')!;
    const problems = PANELS.find(p => p.id === 'problems')!;

    it('matches a panel by exact widget id, or by prefix for Terminal', () => {
        expect(panelOwnsWidget(terminal, 'terminal-2')).toBe(true);
        expect(panelOwnsWidget(problems, 'problems')).toBe(true);
        expect(panelOwnsWidget(problems, 'problems-2')).toBe(false);
    });

    it('lists the right-clicked bar first', () => {
        expect(panelsForBar(PANELS, 'bottom')[0].bar).toBe('bottom');
        expect(panelsForBar(PANELS, 'right')[0].bar).toBe('right');
        expect(panelsForBar(PANELS, 'left')).toHaveLength(PANELS.length);
    });

    it('gives every panel a unique toggle command', () => {
        expect(new Set(PANELS.map(panelCommandId)).size).toBe(PANELS.length);
    });
});
