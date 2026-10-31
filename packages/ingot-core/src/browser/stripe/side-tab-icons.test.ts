import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { BOTTOM_STRIPE, HIDDEN_SIDE_TABS, SIDE_TAB_ICONS } from './ingot-stripe.consts';

const shellCss = fs.readFileSync(path.resolve(__dirname, '../style/shell.css'), 'utf8');
const iconsCss = fs.readFileSync(path.resolve(__dirname, '../style/icons.css'), 'utf8');
const iconAsset = (icon: string): string => path.resolve(__dirname, '../../../../../assets/icons', `${icon}.svg`);

/** `[id^='shell-tab-<id>'] { --ingot-icon: var(--ingot-icon-<icon>); }` rules (tab id without `shell-tab-`), in cascade order. */
const mappings = [...shellCss.matchAll(/\[id\^='shell-tab-([^']+)'\] \{ --ingot-icon: var\(--ingot-icon-([a-z-]+)\); \}/g)].map(([, id, icon]) => ({ id, icon }));
/** Tab id prefixes in each `:is(...)` list that paints the tab icon with the Ingot mask. */
const maskedLists = [...shellCss.matchAll(/\.theia-app-sides :is\(([^)]+)\) \.lm-TabBar-tabIcon/g)]
    .map(([, list]) => [...list.matchAll(/\[id\^='shell-tab-([^']+)'\]/g)].map(([, id]) => id).sort());

/** The icon a tab id ends up with: the last mapping whose prefix matches wins, as in the cascade. */
const iconFor = (tabId: string): string | undefined => mappings.filter(m => tabId.startsWith(m.id)).pop()?.icon;

describe('side bar tab icons', () => {
    const containers = Object.keys(SIDE_TAB_ICONS);

    it('maps every known view container to its icon, on the tab and on its hidden measuring copy', () => {
        for (const id of containers) {
            expect(iconFor(id), id).toBe(SIDE_TAB_ICONS[id]);
            expect(iconFor(`${id}-hidden`), `${id}-hidden`).toBe(SIDE_TAB_ICONS[id]);
        }
        expect(mappings.map(m => m.id).sort()).toEqual([...containers].sort());
    });

    it('resolves every icon to a generated mask and an SVG asset', () => {
        for (const icon of new Set(Object.values(SIDE_TAB_ICONS))) {
            expect(iconsCss, icon).toContain(`--ingot-icon-${icon}: url("data:image/svg+xml`);
            expect(fs.existsSync(iconAsset(icon)), icon).toBe(true);
        }
    });

    it('masks only mapped tabs, so an unmapped container keeps its own icon instead of a blank square', () => {
        expect(shellCss).not.toMatch(/\[id\^='shell-tab-'\] \.lm-TabBar-tabIcon/);
        expect(maskedLists).toHaveLength(2);
        for (const list of maskedLists) {
            expect(list).toEqual([...containers].sort());
        }
    });

    it('gives each visible side bar tab a distinct icon', () => {
        const visible = containers.filter(id => !(HIDDEN_SIDE_TABS as readonly string[]).includes(id)).map(id => SIDE_TAB_ICONS[id]);
        expect(new Set(visible).size).toBe(visible.length);
    });

    it('keeps the Terminal out of the left stripe', () => {
        expect(BOTTOM_STRIPE.map(b => b.id)).not.toContain('terminal');
    });
});
