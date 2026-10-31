import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CONTROL_HEIGHT_PX, RADIUS_SCALE } from '../../common/theme/design-scale.consts';

const css = (file: string): string => fs.readFileSync(path.resolve(__dirname, file), 'utf8');
const tokens = css('tokens.css');
const scale: readonly number[] = Object.values(RADIUS_SCALE);

/** Every literal `border-radius: Npx` in a stylesheet (token references are skipped). */
const literalRadii = (text: string): number[] => [...text.matchAll(/border-radius:\s*(\d+)px/g)].map(([, px]) => Number(px));

describe('design scale', () => {
    it('declares every radius step and the control height in tokens.css', () => {
        for (const [step, px] of Object.entries(RADIUS_SCALE)) {
            expect(tokens, step).toContain(`--ingot-radius-${step}: ${px}px;`);
        }
        expect(tokens).toContain(`--ingot-control-h: ${CONTROL_HEIGHT_PX}px;`);
    });

    it('keeps the agent panel radii on the scale', () => {
        const radii = [...css('agent-panel.css').matchAll(/--ingot-ap-radius[a-z-]*:\s*(\d+)px/g)].map(([, px]) => Number(px));
        expect(radii.length).toBeGreaterThan(0);
        for (const px of radii) {
            expect(scale).toContain(px);
        }
    });

    it('sizes the settings pages and dialog buttons from the tokens', () => {
        const settings = css('settings.css');
        expect(literalRadii(settings).filter(px => !scale.includes(px))).toEqual([]);
        expect(settings).toMatch(/\.ingot-settings-dialog \.dialogControl \.theia-button \{[^}]*height: var\(--ingot-control-h\)/);
        expect(settings).toMatch(/\.ingot-settings-dialog \.dialogControl \.theia-button \{[^}]*border-radius: var\(--ingot-radius-md\)/);
    });

    it('gives Models controls the control height and quiet status badges', () => {
        const shell = css('shell.css');
        expect(shell).toMatch(/\.ingot-models-row \.theia-button \{[^}]*height: var\(--ingot-control-h\)/);
        expect(shell).toMatch(/\.ingot-model-input \{[^}]*height: var\(--ingot-control-h\)/);
        expect(shell).not.toMatch(/\.ingot-model-status \{[^}]*--theia-badge-background/);
    });

    it('keeps the steady Index ready state muted in the status bar', () => {
        expect(css('shell.css')).not.toContain('.ingot-status-index-ready {');
    });
});
