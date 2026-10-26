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
                id: 'appearance', label: 'Appearance', preferences: ['ingot.appearance', SETTINGS_PREFS.colorTheme, SETTINGS_PREFS.iconTheme, 'ingot.layout.chatPosition', 'window.zoomLevel', 'workbench.tree.indent'],
                actions: [{ id: 'importTheme', label: 'Import Color Theme…' }, { id: 'removeTheme', label: 'Remove Imported Theme…' }],
                description: 'Theme follows Light, Dark or System (your OS, live). Choosing another color theme switches to Custom theme.',
                groups: [
                    { label: 'Theme', preferences: ['ingot.appearance', SETTINGS_PREFS.colorTheme, SETTINGS_PREFS.iconTheme] },
                    { label: 'Layout', preferences: ['ingot.layout.chatPosition', 'window.zoomLevel', 'workbench.tree.indent'] }
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
    { id: 'account', label: 'Account', icon: 'account', preferences: ['ingot.account.syncSettings'], description: 'Your Ingot account on this device.' },
    { id: 'plugins', label: 'Plugins', icon: 'extensions', actions: [{ id: 'openPlugins', label: 'Open Marketplace…' }], description: 'Install themes and extensions from Open VSX.' },
    { id: 'vcs', label: 'Version Control', icon: 'source-control', preferences: ['scm.defaultViewMode', 'git.autofetch', 'git.confirmSync'] },
    {
        id: 'tools', label: 'Tools', icon: 'tools', children: [
            {
                id: 'ai', label: 'AI Models', preferences: ['ingot.autocomplete.enabled', 'ingot.autocomplete.model', 'ingot.autocomplete.debounceMs', 'ingot.models.ollamaUrl'],
                actions: [{ id: 'openModels', label: 'Manage API Keys…' }]
            },
            {
                id: 'agent-review', label: 'Agent review',
                description: 'How agent edits are reviewed: checkpoints on big runs, the auto-continue countdown, auto-accept and inline review comments. Also editable in the Ingot settings file under ~/.ingot.',
                preferences: ['ingot.agent.review.enabled', 'ingot.agent.reviewPauseThreshold', 'ingot.agent.reviewAutoContinueSeconds', 'ingot.agent.review.autoAccept', 'ingot.agent.review.inlineComments']
            },
            {
                id: 'agent-approvals', label: 'Agent approvals', custom: 'approvals',
                description: 'Git writes, terminal commands, browser actions, web search / fetch, MCP tool calls and file deletes wait on an approval card (Skip / Always Run / Run). "Always Run" choices are listed here per project; revoke one to be asked again.',
                preferences: ['ingot.agent.git.requireApproval']
            },
            {
                id: 'agent-tools', label: 'Agent tools',
                description: 'What the agent can do in the terminal and the browser, and what asks first. Every action that asks goes through the approval card; "Always Run" choices are listed in Agent approvals.',
                preferences: [
                    'ingot.agent.terminal.enabled', 'ingot.agent.terminal.requireApproval', 'ingot.agent.terminal.foregroundTimeoutSeconds', 'ingot.agent.terminal.maxOutputChars',
                    'ingot.agent.processes.showInChat',
                    'ingot.agent.browser.enabled', 'ingot.agent.browser.requireApproval', 'ingot.agent.browser.approveReads'
                ],
                groups: [
                    { label: 'Terminal & scripts', preferences: ['ingot.agent.terminal.enabled', 'ingot.agent.terminal.requireApproval', 'ingot.agent.terminal.foregroundTimeoutSeconds', 'ingot.agent.terminal.maxOutputChars'] },
                    { label: 'Background processes', preferences: ['ingot.agent.processes.showInChat'] },
                    { label: 'Browser', preferences: ['ingot.agent.browser.enabled', 'ingot.agent.browser.requireApproval', 'ingot.agent.browser.approveReads'] }
                ]
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
