import { describe, expect, it } from 'vitest';
import { TOOL_WINDOW_KEYMAP } from './tool-windows.keymap.consts';
import { findConflicts, resolveKeybinding, resolveKeymap } from './keymap.utils';

describe('keymap', () => {
    it('uses Cmd on macOS and Alt on Windows/Linux for tool windows', () => {
        const project = TOOL_WINDOW_KEYMAP.find(e => e.action === 'Project tool window')!;
        expect(resolveKeybinding(project, true).keybinding).toBe('ctrlcmd+1');
        expect(resolveKeybinding(project, false).keybinding).toBe('alt+1');
    });

    it('has no conflicting tool window shortcuts on either platform', () => {
        expect(findConflicts(resolveKeymap(TOOL_WINDOW_KEYMAP, true))).toEqual([]);
        expect(findConflicts(resolveKeymap(TOOL_WINDOW_KEYMAP, false))).toEqual([]);
    });

    it('detects conflicts', () => {
        expect(findConflicts([
            { command: 'a', keybinding: 'ctrlcmd+k' },
            { command: 'b', keybinding: 'ctrlcmd+k' }
        ])).toEqual(['ctrlcmd+k: a vs b']);
    });
});
