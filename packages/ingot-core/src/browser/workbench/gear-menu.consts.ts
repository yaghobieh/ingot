import type { Command } from '@theia/core/lib/common/command';
import { PRODUCT } from '../../common/product.consts';

/** Bottom-left Settings gear menu (IDEA-117). */
export const GEAR_MENU = ['ingot-gear-menu'];
export const GEAR_MENU_SETTINGS = [...GEAR_MENU, '1_settings'];
export const GEAR_MENU_THEME = [...GEAR_MENU, '2_theme'];
export const GEAR_MENU_THEME_SUBMENU = [...GEAR_MENU_THEME, 'theme'];
export const GEAR_MENU_TOOLS = [...GEAR_MENU, '3_tools'];
export const GEAR_MENU_APP = [...GEAR_MENU, '4_app'];
export const GEAR_THEME_LABEL = 'Theme';

export const GEAR_COMMANDS = {
    open: { id: 'ingot.gear.open', label: 'Manage', category: 'Ingot' },
    settings: { id: 'ingot.gear.settings', label: 'Settings…' },
    themeLight: { id: 'ingot.appearance.light', label: 'Light', category: 'Theme' },
    themeDark: { id: 'ingot.appearance.dark', label: 'Dark', category: 'Theme' },
    themeSystem: { id: 'ingot.appearance.system', label: 'System', category: 'Theme' },
    extensions: { id: 'ingot.gear.extensions', label: 'Extensions' },
    mcp: { id: 'ingot.gear.mcp', label: 'MCP Servers' },
    rules: { id: 'ingot.gear.rules', label: 'Rules & Commands' },
    models: { id: 'ingot.gear.models', label: 'Models & API Keys' },
    keymap: { id: 'ingot.gear.keymap', label: 'Keymap' },
    shortcuts: { id: 'ingot.gear.shortcuts', label: 'Keyboard Shortcuts' },
    memories: { id: 'ingot.gear.memories', label: 'Memories' },
    checkUpdates: { id: 'ingot.checkForUpdates', label: 'Check for Updates…', category: 'Ingot' },
    about: { id: 'ingot.gear.about', label: 'About Ingot' }
} as const satisfies Record<string, Command>;

/** Commands the gear entries run (owned by other contributions). */
export const GEAR_TARGETS = {
    settings: 'ingot.settings.open',
    extensions: 'vsxExtensions.toggle',
    mcp: 'ingot.mcp.toggle',
    rules: 'ingot.agentConfig.open',
    models: 'ingot.models.open',
    shortcuts: 'keymaps:open',
    about: 'ingot.about'
} as const;

export const SETTINGS_PAGES = { keymap: 'keymap', memories: 'memories' } as const;

export const RELEASES_API_URL = 'https://api.github.com/repos/yaghobieh/ingot/releases/latest';
export const RELEASES_PAGE_URL = `${PRODUCT.repositoryUrl}/releases`;
export const UPDATE_TEXT = {
    noRelease: (v: string) => `You're on ${PRODUCT.name} ${v}. No release has been published yet, so this build is the newest.`,
    upToDate: (v: string) => `${PRODUCT.name} ${v} is up to date.`,
    available: (latest: string, current: string) => `${PRODUCT.name} ${latest} is available (you have ${current}).`,
    failed: 'Could not check for updates. Check your connection and try again.',
    download: 'Download'
} as const;
