import { describe, expect, it } from 'vitest';
import { INGOT_KEYMAP } from './ingot.keymap.consts';
import { TOOL_WINDOW_KEYMAP } from './tool-windows.keymap.consts';
import { createDoubleShiftDetector, findConflicts, resolveKeymap } from './keymap.utils';

const key = (action: string, mac: boolean) => resolveKeymap(INGOT_KEYMAP.filter(e => e.action === action), mac)[0]?.keybinding;

describe('Ingot keymap', () => {
    it('matches the Ingot defaults on both platforms', () => {
        expect(key('Go to File', true)).toBe('ctrlcmd+shift+o');
        expect(key('Go to File', false)).toBe('ctrl+shift+n');
        expect(key('Recent Files', true)).toBe('ctrlcmd+e');
        expect(key('Replace', true)).toBe('ctrlcmd+r');
        expect(key('Replace in Files', false)).toBe('ctrl+shift+r');
        expect(key('Rename', false)).toBe('shift+f6');
        expect(key('Reformat Code', true)).toBe('ctrlcmd+alt+l');
        expect(key('Run', true)).toBe('ctrl+r');
        expect(key('Run', false)).toBe('shift+f10');
        expect(key('Duplicate Line or Selection', false)).toBe('ctrl+d');
        expect(key('Agent Audit Log', true)).toBe('ctrlcmd+alt+shift+a');
        expect(key('Agent Audit Log', false)).toBe('ctrl+alt+shift+a');
    });

    it('has no conflicts with itself or the tool window keymap', () => {
        for (const mac of [true, false]) {
            expect(findConflicts(resolveKeymap([...INGOT_KEYMAP, ...TOOL_WINDOW_KEYMAP], mac))).toEqual([]);
        }
    });

    it('never steals the agent review keys while an edit is pending', () => {
        const winBindings = resolveKeymap(INGOT_KEYMAP, false).filter(b => b.keybinding === 'ctrl+y' || b.keybinding === 'ctrl+n');
        expect(winBindings.length).toBe(2);
        expect(winBindings.every(b => b.when?.includes('!ingotChangesPending'))).toBe(true);
    });

    it('detects a double Shift tap', () => {
        let t = 0;
        const detect = createDoubleShiftDetector(400, () => t);
        expect(detect('Shift', false)).toBe(false);
        t = 200;
        expect(detect('Shift', false)).toBe(true);
        t = 300;
        expect(detect('Shift', false)).toBe(false);
        expect(detect('a', false)).toBe(false);
        t = 400;
        expect(detect('Shift', false)).toBe(false);
        t = 1000;
        expect(detect('Shift', false)).toBe(false);
        t = 1100;
        expect(detect('Shift', true)).toBe(false);
    });
});
