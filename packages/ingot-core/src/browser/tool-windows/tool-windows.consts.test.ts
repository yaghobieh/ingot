import { describe, expect, it } from 'vitest';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { REX_STRIPE_MARK, RIGHT_STRIPE_BOTTOM, RIGHT_STRIPE_TOP } from './tool-windows.consts';

describe('right stripe', () => {
    it('shows the agent as the Rex mark, and only the agent', () => {
        const marked = [...RIGHT_STRIPE_TOP, ...RIGHT_STRIPE_BOTTOM].filter(item => item.kind === 'panel' && item.mark === REX_STRIPE_MARK);
        expect(marked.map(item => item.kind === 'panel' && item.widgetId)).toEqual([AGENTS_WIDGET_ID]);
    });
});
