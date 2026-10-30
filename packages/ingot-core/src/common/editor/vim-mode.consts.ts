import type { VimExCommand, VimModeLabel } from './vim-mode.types';

/** IDEA-286: Vim keys in code editors (monaco-vim). Off by default. */
export const VIM_MODE_PREF = 'editor.vimMode';
export const VIM_MODE_DEFAULT = false;

export const VIM_COMMANDS = {
    toggle: { id: 'ingot.editor.toggleVimMode', label: 'Toggle Vim Mode', category: 'Editor' }
} as const;

export const VIM_STATUS_ID = 'ingot-vim-mode';
export const VIM_STATUS_CLASS = 'ingot-vim-status';
export const VIM_CMDLINE_CLASS = 'ingot-vim-cmdline';
/** Attribute on the editor widget node while Vim keys are on (for styling and e2e). */
export const VIM_ACTIVE_ATTR = 'data-ingot-vim';
export const VIM_STATUS_PRIORITY = 200;

export const VIM_LABELS: Readonly<Record<string, VimModeLabel>> = {
    normal: 'NORMAL',
    insert: 'INSERT',
    visual: 'VISUAL',
    replace: 'REPLACE'
};

export const VIM_VISUAL_SUBMODES: Readonly<Record<string, VimModeLabel>> = {
    linewise: 'VISUAL LINE',
    blockwise: 'VISUAL BLOCK'
};

/** Status bar text color per mode (design tokens; Theia sets entry colors inline). */
export const VIM_MODE_COLORS: Readonly<Record<VimModeLabel, string>> = {
    'NORMAL': 'var(--ingot-primary)',
    'INSERT': 'var(--ingot-success)',
    'VISUAL': 'var(--ingot-accent)',
    'VISUAL LINE': 'var(--ingot-accent)',
    'VISUAL BLOCK': 'var(--ingot-accent)',
    'REPLACE': 'var(--ingot-danger)'
};

/** Ex commands mapped to Ingot save / close. `prefix` is the shortest form Vim accepts. */
export const VIM_EX_COMMANDS: readonly VimExCommand[] = [
    { name: 'write', prefix: 'w' },
    { name: 'quit', prefix: 'q' },
    { name: 'wq', prefix: 'wq' },
    { name: 'xit', prefix: 'x' },
    { name: 'wall', prefix: 'wa' },
    { name: 'qall', prefix: 'qa' }
];

export const VIM_BANG = '!';
