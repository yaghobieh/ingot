import { describe, expect, it } from 'vitest';
import { VIM_EX_COMMANDS } from './vim-mode.consts';
import { vimEnabled, vimExAction, vimModeLabel } from './vim-mode.utils';

describe('vim mode', () => {
    it('labels the modes for the status bar', () => {
        expect(vimModeLabel({ mode: 'normal' })).toBe('NORMAL');
        expect(vimModeLabel({ mode: 'insert' })).toBe('INSERT');
        expect(vimModeLabel({ mode: 'visual', subMode: '' })).toBe('VISUAL');
        expect(vimModeLabel({ mode: 'visual', subMode: 'linewise' })).toBe('VISUAL LINE');
        expect(vimModeLabel({ mode: 'visual', subMode: 'blockwise' })).toBe('VISUAL BLOCK');
        expect(vimModeLabel({ mode: 'replace' })).toBe('REPLACE');
        expect(vimModeLabel({ mode: 'unknown' })).toBe('NORMAL');
    });

    it('maps :w :q :wq :x to Ingot save and close', () => {
        expect(vimExAction('write')).toBe('save');
        expect(vimExAction('quit')).toBe('close');
        expect(vimExAction('quit', '!')).toBe('forceClose');
        expect(vimExAction('wq')).toBe('saveClose');
        expect(vimExAction('xit')).toBe('saveClose');
        expect(vimExAction('wall')).toBe('saveAll');
        expect(vimExAction('qall')).toBe('closeAll');
        expect(vimExAction('sort')).toBeUndefined();
    });

    it('registers every Ex command with a valid prefix', () => {
        for (const command of VIM_EX_COMMANDS) {
            expect(command.name.startsWith(command.prefix)).toBe(true);
            expect(vimExAction(command.name)).toBeDefined();
        }
    });

    it('is off unless the setting is true', () => {
        expect(vimEnabled(undefined)).toBe(false);
        expect(vimEnabled('true')).toBe(false);
        expect(vimEnabled(true)).toBe(true);
    });
});
