import { describe, expect, it } from 'vitest';
import { editRerunPlan, promptClickAction, typesCharacter } from './composer-usability';
import { EDIT_RERUN_CHOICES, PINNED_SLACK_PX } from './composer-usability.consts';

const click = { editing: false, onControl: false, selecting: false, latest: false, pinnedOffset: 0 };

describe('editRerunPlan (IDEA-280)', () => {
    it('reverts only for the revert choice and reruns unless cancelled', () => {
        expect(editRerunPlan('revert')).toEqual({ rerun: true, revert: true });
        expect(editRerunPlan('keep')).toEqual({ rerun: true, revert: false });
        expect(editRerunPlan('cancel')).toEqual({ rerun: false, revert: false });
    });

    it('offers the three choices in order', () => {
        expect(EDIT_RERUN_CHOICES.map(c => c.id)).toEqual(['revert', 'keep', 'cancel']);
        expect(EDIT_RERUN_CHOICES[0].label).toBe('Revert changes after this point and rerun');
        expect(EDIT_RERUN_CHOICES[1].label).toBe('Keep changes and rerun');
    });
});

const stroke = (key: string, code: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}) =>
    ({ key, code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt });

describe('typesCharacter (IDEA-280)', () => {
    it('treats plain and shifted printable keys as typing on every platform', () => {
        for (const [key, code] of [['\\', 'Backslash'], ['|', 'Backslash'], ['`', 'Backquote'], ['~', 'Backquote'], ['a', 'KeyA']]) {
            expect(typesCharacter(stroke(key, code), true)).toBe(true);
            expect(typesCharacter(stroke(key, code), false)).toBe(true);
        }
    });

    it('treats macOS Option characters and dead keys as typing (European layouts)', () => {
        expect(typesCharacter(stroke('\\', 'Digit7', { alt: true }), true)).toBe(true);
        expect(typesCharacter(stroke('|', 'Digit7', { alt: true }), true)).toBe(true);
        expect(typesCharacter(stroke('Dead', 'KeyN', { alt: true }), true)).toBe(true);
        expect(typesCharacter(stroke('ç', 'KeyC', { alt: true }), true)).toBe(true);
    });

    it('treats AltGr characters on Windows / Linux as typing', () => {
        expect(typesCharacter(stroke('\\', 'Minus', { ctrl: true, alt: true }), false)).toBe(true);
        expect(typesCharacter(stroke('ś', 'KeyS', { ctrl: true, alt: true }), false)).toBe(true);
        expect(typesCharacter(stroke('{', 'Digit7', { ctrl: true, alt: true }), false)).toBe(true);
    });

    it('keeps real shortcuts', () => {
        expect(typesCharacter(stroke('.', 'Period', { meta: true }), true)).toBe(false);
        expect(typesCharacter(stroke('.', 'Period', { ctrl: true }), false)).toBe(false);
        expect(typesCharacter(stroke('r', 'KeyR', { ctrl: true }), true)).toBe(false);
        expect(typesCharacter(stroke('n', 'KeyN', { ctrl: true, alt: true }), false)).toBe(false);
        expect(typesCharacter(stroke('1', 'Digit1', { alt: true }), false)).toBe(false);
        expect(typesCharacter(stroke('Enter', 'Enter'), true)).toBe(false);
        expect(typesCharacter(stroke('Escape', 'Escape'), false)).toBe(false);
    });
});

describe('promptClickAction (IDEA-280)', () => {
    it('opens the edit for a sent prompt', () => {
        expect(promptClickAction(click)).toBe('edit');
        expect(promptClickAction({ ...click, latest: true })).toBe('edit');
    });

    it('scrolls the pinned latest prompt back first', () => {
        expect(promptClickAction({ ...click, latest: true, pinnedOffset: PINNED_SLACK_PX + 1 })).toBe('reveal');
        expect(promptClickAction({ ...click, latest: true, pinnedOffset: PINNED_SLACK_PX })).toBe('edit');
        expect(promptClickAction({ ...click, latest: false, pinnedOffset: 200 })).toBe('edit');
    });

    it('ignores clicks while editing, on controls, or ending a selection', () => {
        expect(promptClickAction({ ...click, editing: true })).toBe('none');
        expect(promptClickAction({ ...click, onControl: true })).toBe('none');
        expect(promptClickAction({ ...click, selecting: true })).toBe('none');
    });
});
