export const PLUGIN_CATEGORIES = [
    { id: 'themes', label: 'Themes', query: 'theme' },
    { id: 'icons', label: 'Icon Themes', query: 'icon theme' },
    { id: 'languages', label: 'Languages', query: 'language support' },
    { id: 'linters', label: 'Linters', query: 'lint' },
    { id: 'keymaps', label: 'Keymaps', query: 'keymap' },
    { id: 'ai', label: 'AI', query: 'ai' }
] as const;

export type PluginsTab = 'marketplace' | 'installed';

export const OPEN_VSX_URL = 'https://open-vsx.org';
export const OPEN_VSX_PUBLISH_DOCS = 'https://github.com/eclipse/openvsx/wiki/Publishing-Extensions';
