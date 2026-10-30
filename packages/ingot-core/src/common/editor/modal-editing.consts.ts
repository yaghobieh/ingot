import type { ModalExCommand, ModalEditingLabel } from './modal-editing.types';

/** IDEA-286: modal editing in code editors (monaco-vim). Off by default. */
export const MODAL_EDITING_PREF = 'ingot.editor.modalEditing';
export const MODAL_EDITING_DEFAULT = false;

export const MODAL_EDITING_COMMANDS = {
    toggle: { id: 'ingot.editor.toggleModalEditing', label: 'Toggle Modal Editing', category: 'Editor' }
} as const;

export const MODAL_STATUS_ID = 'ingot-modal-editing';
export const MODAL_STATUS_CLASS = 'ingot-modal-status';
export const MODAL_CMDLINE_CLASS = 'ingot-modal-cmdline';
/** Attribute on the editor widget node while modal editing is on (for styling and e2e). */
export const MODAL_ACTIVE_ATTR = 'data-ingot-modal';
export const MODAL_STATUS_PRIORITY = 200;
export const MODAL_STATUS_TOOLTIP = 'Modal editing. Click to turn it off.';

export const MODAL_LABELS: Readonly<Record<string, ModalEditingLabel>> = {
    normal: 'NORMAL',
    insert: 'INSERT',
    visual: 'VISUAL',
    replace: 'REPLACE'
};

export const MODAL_VISUAL_SUBMODES: Readonly<Record<string, ModalEditingLabel>> = {
    linewise: 'VISUAL LINE',
    blockwise: 'VISUAL BLOCK'
};

/** Status bar text color per mode (design tokens; Theia sets entry colors inline). */
export const MODAL_EDITING_COLORS: Readonly<Record<ModalEditingLabel, string>> = {
    'NORMAL': 'var(--ingot-primary)',
    'INSERT': 'var(--ingot-success)',
    'VISUAL': 'var(--ingot-accent)',
    'VISUAL LINE': 'var(--ingot-accent)',
    'VISUAL BLOCK': 'var(--ingot-accent)',
    'REPLACE': 'var(--ingot-danger)'
};

/** Ex commands mapped to Ingot save / close. `prefix` is the shortest accepted form. */
export const MODAL_EX_COMMANDS: readonly ModalExCommand[] = [
    { name: 'write', prefix: 'w' },
    { name: 'quit', prefix: 'q' },
    { name: 'wq', prefix: 'wq' },
    { name: 'xit', prefix: 'x' },
    { name: 'wall', prefix: 'wa' },
    { name: 'qall', prefix: 'qa' }
];

export const MODAL_BANG = '!';
