import { describe, expect, it } from 'vitest';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckIcon, ChevronIcon, MoreIcon, SendIcon } from './agent-icons';
import { AGENT_ICON_PATHS, AGENT_ICON_SIZE } from './agent-icons.consts';
import { copyIconHtml } from './agent-icons.utils';

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe('agent panel icons', () => {
    it('draw in currentColor at the mock sizes and stay hidden from screen readers', () => {
        const check = render(React.createElement(CheckIcon));
        expect(check).toContain(`width="${AGENT_ICON_SIZE.check}"`);
        expect(check).toContain('stroke="currentColor"');
        expect(check).toContain('aria-hidden="true"');
        expect(check).toContain(AGENT_ICON_PATHS.check);
        expect(render(React.createElement(SendIcon))).toContain(AGENT_ICON_PATHS.send);
        expect(render(React.createElement(MoreIcon)).match(/<circle/g)).toHaveLength(3);
    });

    it('point the chevron down when open and right when closed', () => {
        expect(render(React.createElement(ChevronIcon, { open: true }))).toContain(AGENT_ICON_PATHS.chevronDown);
        expect(render(React.createElement(ChevronIcon, { open: false }))).toContain(AGENT_ICON_PATHS.chevronRight);
    });

    it('give code blocks the same copy icon as markup', () => {
        const copy = copyIconHtml();
        expect(copy).toMatch(/^<svg class="ingot-agent-icon"/);
        expect(copy).toContain('<rect');
        expect(copy).toContain(AGENT_ICON_PATHS.copyBack);
    });
});
