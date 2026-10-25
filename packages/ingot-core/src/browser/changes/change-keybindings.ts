import { inject, injectable } from '@theia/core/shared/inversify';
import { type FrontendApplicationContribution, KeybindingRegistry } from '@theia/core/lib/browser';
import { CHANGE_COMMANDS, NEXT_CHANGE_KEY, PREV_CHANGE_KEY } from './changes.browser-consts';
import { CHANGES_PENDING_KEY } from '../../common/changes/changes.consts';
import { ACCEPT_EDIT_KEY, AGENT_COMMANDS, REJECT_EDIT_KEY } from '../agents/agents.consts';

/**
 * Review shortcuts for agent changes (IDEA-102). Registered on start, after every contribution's
 * defaults (move lines, redo…), so while changes wait ⌥↓ / ⌥↑ and Ctrl+Y / Ctrl+N review them.
 */
const EDITOR_FOCUS_KEY = 'editorTextFocus';

@injectable()
export class ChangeKeybindingsContribution implements FrontendApplicationContribution {

    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;

    onStart(): void {
        const keys: [string, string][] = [
            [AGENT_COMMANDS.acceptEdit.id, ACCEPT_EDIT_KEY],
            [AGENT_COMMANDS.rejectEdit.id, REJECT_EDIT_KEY],
            [CHANGE_COMMANDS.next.id, NEXT_CHANGE_KEY],
            [CHANGE_COMMANDS.prev.id, PREV_CHANGE_KEY]
        ];
        // Theia prefers bindings that use a key local to the focused element (editorTextFocus),
        // so the editor gets its own copy; the plain one covers the chat and everything else.
        this.keybindings.registerKeybindings(...keys.flatMap(([command, keybinding]) => [
            { command, keybinding, when: CHANGES_PENDING_KEY },
            { command, keybinding, when: `${EDITOR_FOCUS_KEY} && ${CHANGES_PENDING_KEY}` }
        ]));
    }
}
