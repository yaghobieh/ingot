import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { AGENT_CARD_BUTTON_HEIGHT_PX, AGENT_CARD_CLASSES } from '../../common/theme/agent-cards.consts';

const css = (file: string): string => fs.readFileSync(path.resolve(__dirname, file), 'utf8');
const cards = css('agent-cards.css');
const HEX = /#[0-9a-f]{3,8}\b/i;

/** The declarations of the first rule whose selector contains `marker`. */
const ruleBody = (text: string, marker: string): string => {
    const at = text.indexOf(marker);
    expect(at, marker).toBeGreaterThanOrEqual(0);
    return text.slice(text.indexOf('{', at) + 1, text.indexOf('}', at));
};

describe('agent cards', () => {
    it('loads after every older layer', () => {
        const imports = [...css('index.css').matchAll(/@import '\.\/([\w-]+)\.css'/g)].map(([, name]) => name);
        expect(imports.at(-1)).toBe('agent-cards');
    });

    it('uses design tokens only: no hex colors, radii from the scale, whole-pixel font sizes', () => {
        expect(cards).not.toMatch(HEX);
        expect(cards).not.toMatch(/rgba?\(/);
        expect([...cards.matchAll(/border-radius:\s*([^;]+);/g)].map(([, value]) => value).filter(value => !value.startsWith('var(--ingot-radius-'))).toEqual([]);
        expect(cards).not.toMatch(/font-size:\s*\d+\.\d+px/);
    });

    it('gives every card the same even border, radius and background with no side bar', () => {
        const body = ruleBody(cards, AGENT_CARD_CLASSES[0]);
        const selector = cards.slice(0, cards.indexOf('{', cards.indexOf(AGENT_CARD_CLASSES[0])));
        for (const card of AGENT_CARD_CLASSES) {
            expect(selector, card).toContain(card);
        }
        expect(body).toContain('border: 1px solid var(--ingot-agent-border)');
        expect(body).toContain('border-radius: var(--ingot-radius-lg)');
        expect(body).toContain('box-shadow: none');
        expect(body).toContain('background: var(--ingot-agent-card)');
        expect(cards).not.toMatch(/border-left:\s*[2-9]px/);
    });

    it('sizes card buttons and makes the main action the accent button', () => {
        const button = ruleBody(cards, '.ingot-approval-actions button');
        expect(button).toContain(`height: ${AGENT_CARD_BUTTON_HEIGHT_PX}px`);
        expect(button).toContain('border-radius: var(--ingot-radius-md)');
        expect(ruleBody(cards, '.ingot-approval-actions .ingot-approval-run')).toContain('background: var(--ingot-agent-accent)');
        expect(ruleBody(cards, '.ingot-ask-card #ingot-ask-submit {')).toContain('background: var(--ingot-agent-accent)');
    });

    it('lines cards above the composer up with its 12px side margins', () => {
        expect(ruleBody(cards, '.ingot-agents-root > :is(.ingot-doom-card')).toContain('margin: 0 12px 8px');
        expect(ruleBody(cards, '.ingot-approval-wrap {')).toContain('margin: 0 12px 8px');
    });

    it('keeps tool card colors on tokens outside the variable definitions', () => {
        const rules = css('tool-cards.css').split('\n').filter(line => !line.trim().startsWith('--'));
        expect(rules.filter(line => HEX.test(line))).toEqual([]);
    });
});
