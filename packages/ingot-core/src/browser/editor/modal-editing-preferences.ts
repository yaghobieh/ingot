import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { MODAL_EDITING_DEFAULT, MODAL_EDITING_PREF } from '../../common/editor/modal-editing.consts';

/** IDEA-286: modal editing in code editors. Also toggled by Editor: Toggle Modal Editing. */
export const modalEditingPreferenceSchema: PreferenceSchema = {
    properties: {
        [MODAL_EDITING_PREF]: {
            type: 'boolean', default: MODAL_EDITING_DEFAULT,
            description: 'Modal editing in code editors (Normal, Insert and Visual modes). :w saves, :q closes, :wq saves and closes. Ingot shortcuts and the agent chat keep their keys.'
        }
    }
};
