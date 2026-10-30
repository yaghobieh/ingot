import { describe, expect, it } from 'vitest';
import { MODAL_EX_COMMANDS } from './modal-editing.consts';
import { modalEditingEnabled, modalEditingLabel, modalExAction } from './modal-editing.utils';

describe('modal editing', () => {
    it('labels the modes for the status bar', () => {
        expect(modalEditingLabel({ mode: 'normal' })).toBe('NORMAL');
        expect(modalEditingLabel({ mode: 'insert' })).toBe('INSERT');
        expect(modalEditingLabel({ mode: 'visual', subMode: '' })).toBe('VISUAL');
        expect(modalEditingLabel({ mode: 'visual', subMode: 'linewise' })).toBe('VISUAL LINE');
        expect(modalEditingLabel({ mode: 'visual', subMode: 'blockwise' })).toBe('VISUAL BLOCK');
        expect(modalEditingLabel({ mode: 'replace' })).toBe('REPLACE');
        expect(modalEditingLabel({ mode: 'unknown' })).toBe('NORMAL');
    });

    it('maps :w :q :wq :x to Ingot save and close', () => {
        expect(modalExAction('write')).toBe('save');
        expect(modalExAction('quit')).toBe('close');
        expect(modalExAction('quit', '!')).toBe('forceClose');
        expect(modalExAction('wq')).toBe('saveClose');
        expect(modalExAction('xit')).toBe('saveClose');
        expect(modalExAction('wall')).toBe('saveAll');
        expect(modalExAction('qall')).toBe('closeAll');
        expect(modalExAction('sort')).toBeUndefined();
    });

    it('registers every Ex command with a valid prefix', () => {
        for (const command of MODAL_EX_COMMANDS) {
            expect(command.name.startsWith(command.prefix)).toBe(true);
            expect(modalExAction(command.name)).toBeDefined();
        }
    });

    it('is off unless the setting is true', () => {
        expect(modalEditingEnabled(undefined)).toBe(false);
        expect(modalEditingEnabled('true')).toBe(false);
        expect(modalEditingEnabled(true)).toBe(true);
    });
});
