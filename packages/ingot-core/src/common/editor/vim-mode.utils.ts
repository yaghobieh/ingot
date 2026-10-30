import { VIM_BANG, VIM_LABELS, VIM_VISUAL_SUBMODES } from './vim-mode.consts';
import type { VimExAction, VimModeChange, VimModeLabel } from './vim-mode.types';

export const vimModeLabel = (change: VimModeChange): VimModeLabel => {
    if (change.mode === 'visual' && change.subMode) {
        return VIM_VISUAL_SUBMODES[change.subMode] ?? VIM_LABELS.visual;
    }
    return VIM_LABELS[change.mode] ?? VIM_LABELS.normal;
};

/** The Ingot action for an Ex command name (as registered) and its argument text (`!` forces). */
export const vimExAction = (name: string, argString = ''): VimExAction | undefined => {
    const bang = argString.trim().startsWith(VIM_BANG);
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

/** A preference value that turns Vim keys on. Anything but `true` keeps them off. */
export const vimEnabled = (value: unknown): boolean => value === true;
