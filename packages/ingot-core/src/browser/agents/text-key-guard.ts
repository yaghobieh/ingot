import { injectable } from '@theia/core/shared/inversify';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { typesCharacter } from '../../common/agents/composer-usability';
import { TEXT_FIELD_SELECTOR } from '../../common/agents/composer-usability.consts';
import { AGENTS_WIDGET_ID } from './agents.consts';

/** True for a keystroke that types a character into a text field of the Agents panel. */
export const typesIntoAgentsField = (event: KeyboardEvent, mac = isOSX): boolean => {
    const target = event.target;
    return target instanceof HTMLElement && !!target.closest(`#${AGENTS_WIDGET_ID}`) && !!target.closest(TEXT_FIELD_SELECTOR) && typesCharacter(event, mac);
};

/**
 * IDEA-280: keybindings match physical keys, so Option (macOS) and AltGr (Windows / Linux) characters such as
 * `\` `|` `~` collided with workbench shortcuts and were never typed in the chat composer. Characters typed into the
 * Agents panel's text fields skip keybinding matching; every other listener still sees the key.
 */
@injectable()
export class IngotKeybindingRegistry extends KeybindingRegistry {

    override run(event: KeyboardEvent): void {
        if (typesIntoAgentsField(event)) {
            this.keySequence = [];
            return;
        }
        super.run(event);
    }
}
