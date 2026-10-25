import type { SettingsPage } from './settings.types';

export const SETTINGS_PREFS = {
    colorTheme: 'workbench.colorTheme',
    iconTheme: 'workbench.iconTheme'
} as const;

/** IDE-style Settings tree (IDEA-34). */
export const SETTINGS_TREE: readonly SettingsPage[] = [
    {
        id: 'appearance-behavior', label: 'Appearance & Behavior', children: [
            {
                id: 'appearance', label: 'Appearance', preferences: ['ingot.appearance', SETTINGS_PREFS.colorTheme, SETTINGS_PREFS.iconTheme, 'window.zoomLevel', 'workbench.tree.indent'],
                actions: [{ id: 'importTheme', label: 'Import Color Theme…' }, { id: 'removeTheme', label: 'Remove Imported Theme…' }],
                description: 'Theme follows Light, Dark or System (your OS, live). Choosing another color theme (Ember, high contrast, plugin or imported themes) switches to Custom theme.'
            },
            { id: 'system', label: 'System Settings', preferences: ['files.autoSave', 'files.autoSaveDelay', 'window.title'] }
        ]
    },
    {
        id: 'keymap', label: 'Keymap', preferences: ['ingot.keymap'],
        actions: [{ id: 'openKeymap', label: 'Edit Shortcuts…' }]
    },
    {
        id: 'editor', label: 'Editor', children: [
            { id: 'editor-general', label: 'General', preferences: ['editor.wordWrap', 'editor.minimap.enabled', 'editor.renderWhitespace', 'editor.formatOnSave', 'editor.stickyScroll.enabled'] },
            { id: 'editor-font', label: 'Font', preferences: ['editor.fontFamily', 'editor.fontSize', 'editor.lineHeight', 'editor.fontLigatures'] },
            { id: 'editor-code-style', label: 'Code Style', preferences: ['editor.tabSize', 'editor.insertSpaces', 'editor.detectIndentation', 'files.insertFinalNewline', 'files.trimTrailingWhitespace'] }
        ]
    },
    { id: 'plugins', label: 'Plugins', actions: [{ id: 'openPlugins', label: 'Open Marketplace…' }], description: 'Install themes and extensions from Open VSX.' },
    { id: 'vcs', label: 'Version Control', preferences: ['scm.defaultViewMode', 'git.autofetch', 'git.confirmSync'] },
    {
        id: 'tools', label: 'Tools', children: [
            {
                id: 'ai', label: 'AI Models', preferences: ['ingot.autocomplete.enabled', 'ingot.autocomplete.model', 'ingot.autocomplete.debounceMs', 'ingot.models.ollamaUrl'],
                actions: [{ id: 'openModels', label: 'Manage API Keys…' }]
            },
            { id: 'agent-config', label: 'Rules & MCP', actions: [{ id: 'openAgentConfig', label: 'Open Rules, Commands & MCP Servers…' }] },
            { id: 'terminal', label: 'Terminal', preferences: ['terminal.integrated.fontSize', 'terminal.integrated.cursorBlinking'] }
        ]
    },
    {
        id: 'advanced', label: 'Advanced Settings', actions: [{ id: 'openAllSettings', label: 'Open All Settings…' }, { id: 'openSettingsJson', label: 'Edit settings.json' }]
    }
];
