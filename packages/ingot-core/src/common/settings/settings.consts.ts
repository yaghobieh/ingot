import type { SettingsPage } from './settings.types';

export const SETTINGS_PREFS = {
    colorTheme: 'workbench.colorTheme',
    iconTheme: 'workbench.iconTheme'
} as const;

/** IDE-style Settings tree (IDEA-34). */
export const SETTINGS_TREE: readonly SettingsPage[] = [
    {
        id: 'appearance-behavior', label: 'Appearance & Behavior', icon: 'symbol-color', children: [
            {
                id: 'appearance', label: 'Appearance', preferences: ['ingot.appearance', SETTINGS_PREFS.colorTheme, SETTINGS_PREFS.iconTheme, 'window.zoomLevel', 'workbench.tree.indent'],
                actions: [{ id: 'importTheme', label: 'Import Color Theme…' }, { id: 'removeTheme', label: 'Remove Imported Theme…' }],
                description: 'Theme follows Light, Dark or System (your OS, live). Choosing another color theme switches to Custom theme.',
                groups: [
                    { label: 'Theme', preferences: ['ingot.appearance', SETTINGS_PREFS.colorTheme, SETTINGS_PREFS.iconTheme] },
                    { label: 'Layout', preferences: ['window.zoomLevel', 'workbench.tree.indent'] }
                ]
            },
            {
                id: 'system', label: 'System Settings', preferences: ['files.autoSave', 'files.autoSaveDelay', 'window.title'],
                groups: [{ label: 'Saving', preferences: ['files.autoSave', 'files.autoSaveDelay'] }, { label: 'Window', preferences: ['window.title'] }]
            }
        ]
    },
    {
        id: 'keymap', label: 'Keymap', icon: 'keyboard', preferences: ['ingot.keymap'],
        actions: [{ id: 'openKeymap', label: 'Edit Shortcuts…' }]
    },
    {
        id: 'editor', label: 'Editor', icon: 'edit', children: [
            { id: 'editor-general', label: 'General', preferences: ['editor.wordWrap', 'editor.minimap.enabled', 'editor.renderWhitespace', 'editor.formatOnSave', 'editor.stickyScroll.enabled'] },
            { id: 'editor-font', label: 'Font', preferences: ['editor.fontFamily', 'editor.fontSize', 'editor.lineHeight', 'editor.fontLigatures'] },
            { id: 'editor-code-style', label: 'Code Style', preferences: ['editor.tabSize', 'editor.insertSpaces', 'editor.detectIndentation', 'files.insertFinalNewline', 'files.trimTrailingWhitespace'] }
        ]
    },
    { id: 'plugins', label: 'Plugins', icon: 'extensions', actions: [{ id: 'openPlugins', label: 'Open Marketplace…' }], description: 'Install themes and extensions from Open VSX.' },
    { id: 'vcs', label: 'Version Control', icon: 'source-control', preferences: ['scm.defaultViewMode', 'git.autofetch', 'git.confirmSync'] },
    {
        id: 'tools', label: 'Tools', icon: 'tools', children: [
            {
                id: 'ai', label: 'AI Models', preferences: ['ingot.autocomplete.enabled', 'ingot.autocomplete.model', 'ingot.autocomplete.debounceMs', 'ingot.models.ollamaUrl'],
                actions: [{ id: 'openModels', label: 'Manage API Keys…' }]
            },
            { id: 'agent-config', label: 'Rules & MCP', actions: [{ id: 'openAgentConfig', label: 'Open Rules, Commands & MCP Servers…' }] },
            {
                id: 'memories', label: 'Memories', custom: 'memories',
                description: 'Facts and preferences agents remember between chats. Project memories stay on this machine (git-ignored); global ones apply to every project.'
            },
            { id: 'terminal', label: 'Terminal', preferences: ['terminal.integrated.fontSize', 'terminal.integrated.cursorBlinking'] }
        ]
    },
    {
        id: 'advanced', label: 'Advanced Settings', icon: 'settings', actions: [{ id: 'openSettingsJson', label: 'Edit settings.json' }],
        description: 'Every preference can also be edited as JSON.'
    }
];
