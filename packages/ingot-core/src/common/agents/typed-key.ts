import { ALT_GRAPH } from './typed-key.consts';
import type { TypedKeyEvent } from './typed-key.types';

/**
 * IDEA-265: true when the key types a character into a text field (`\`, `|`, letters, Option / AltGr symbols).
 * Shortcuts with Ctrl or Cmd are not typing, except AltGr.
 */
export const typesCharacter = (e: TypedKeyEvent): boolean => {
    if (e.isComposing || [...e.key].length !== 1) {
        return false;
    }
    return !(e.ctrlKey || e.metaKey) || !!e.getModifierState?.(ALT_GRAPH);
};
