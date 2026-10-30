import { MODAL_BANG, MODAL_LABELS, MODAL_VISUAL_SUBMODES } from './modal-editing.consts';
import type { ModalExAction, ModalEditingChange, ModalEditingLabel } from './modal-editing.types';

export const modalEditingLabel = (change: ModalEditingChange): ModalEditingLabel => {
    if (change.mode === 'visual' && change.subMode) {
        return MODAL_VISUAL_SUBMODES[change.subMode] ?? MODAL_LABELS.visual;
    }
    return MODAL_LABELS[change.mode] ?? MODAL_LABELS.normal;
};

/** The Ingot action for an Ex command name (as registered) and its argument text (`!` forces). */
export const modalExAction = (name: string, argString = ''): ModalExAction | undefined => {
    const bang = argString.trim().startsWith(MODAL_BANG);
    switch (name) {
        case 'write': return 'save';
        case 'quit': return bang ? 'forceClose' : 'close';
        case 'wq':
        case 'xit': return 'saveClose';
        case 'wall': return 'saveAll';
        case 'qall': return 'closeAll';
        default: return undefined;
    }
};

/** A preference value that turns modal editing on. Anything but `true` keeps it off. */
export const modalEditingEnabled = (value: unknown): boolean => value === true;
