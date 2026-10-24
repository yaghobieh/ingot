import type { MenuDto } from '@theia/core/lib/electron-common/electron-api';

export const APP_MENU_COMMANDS = {
    about: 'ingot.about',
    settings: 'ingot.settings.open'
} as const;

/** The macOS application menu ("Ingot") with About, Settings… (Cmd+,), Services, Hide and Quit (IDEA-69). */
export const buildAppMenu = (productName: string, run: (commandId: string) => void): MenuDto => ({
    label: productName,
    submenu: [
        { id: 'ingot-app-about', label: `About ${productName}`, execute: () => run(APP_MENU_COMMANDS.about) },
        { type: 'separator' },
        { id: 'ingot-app-settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,', execute: () => run(APP_MENU_COMMANDS.settings) },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { label: `Hide ${productName}`, role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: `Quit ${productName}`, role: 'quit' }
    ]
});
