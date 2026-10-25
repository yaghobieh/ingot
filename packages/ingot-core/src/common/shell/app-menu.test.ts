import { describe, expect, it } from 'vitest';
import { APP_MENU_COMMANDS, buildAppMenu } from './app-menu';

describe('macOS app menu', () => {
    it('has About, Settings… with Cmd+, and the standard Hide/Quit roles', () => {
        const ran: string[] = [];
        const menu = buildAppMenu('Ingot', id => ran.push(id));
        expect(menu.label).toBe('Ingot');
        const items = menu.submenu ?? [];
        expect(items.filter(i => i.type !== 'separator').map(i => i.label ?? i.role)).toEqual(['About Ingot', 'Settings…', 'services', 'Hide Ingot', 'hideOthers', 'unhide', 'Quit Ingot']);
        const settings = items.find(i => i.label === 'Settings…');
        expect(settings?.accelerator).toBe('CmdOrCtrl+,');
        settings?.execute?.();
        items.find(i => i.label === 'About Ingot')?.execute?.();
        expect(ran).toEqual([APP_MENU_COMMANDS.settings, APP_MENU_COMMANDS.about]);
        expect(items.find(i => i.label === 'Quit Ingot')?.role).toBe('quit');
    });
});
