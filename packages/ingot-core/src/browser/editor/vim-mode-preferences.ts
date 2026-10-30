import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { VIM_MODE_DEFAULT, VIM_MODE_PREF } from '../../common/editor/vim-mode.consts';

/** IDEA-286: Vim keys in code editors. Also toggled by Editor: Toggle Vim Mode. */
export const vimModePreferenceSchema: PreferenceSchema = {
    properties: {
        [VIM_MODE_PREF]: {
            type: 'boolean', default: VIM_MODE_DEFAULT,
            description: 'Vim keys in code editors (Normal, Insert and Visual modes). :w saves, :q closes, :wq saves and closes. Ingot shortcuts and the agent chat keep their keys.'
        }
    }
};
