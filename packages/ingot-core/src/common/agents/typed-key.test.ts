import { describe, expect, it } from 'vitest';
import { typesCharacter } from './typed-key';
import type { TypedKeyEvent } from './typed-key.types';

const key = (k: string, extra: Partial<TypedKeyEvent> = {}): TypedKeyEvent => ({ key: k, ctrlKey: false, metaKey: false, ...extra });

describe('typesCharacter (IDEA-265)', () => {
    it('counts plain and shifted characters, backslash included', () => {
        expect(typesCharacter(key('\\'))).toBe(true);
        expect(typesCharacter(key('|'))).toBe(true);
        expect(typesCharacter(key('a'))).toBe(true);
        expect(typesCharacter(key(' '))).toBe(true);
        expect(typesCharacter(key('😀'))).toBe(true);
    });
    it('counts Option and AltGr symbols', () => {
        expect(typesCharacter(key('\\', { getModifierState: () => false }))).toBe(true);
        expect(typesCharacter(key('\\', { ctrlKey: true, getModifierState: m => m === 'AltGraph' }))).toBe(true);
    });
    it('leaves shortcuts, named keys and IME composition to the workbench', () => {
        expect(typesCharacter(key('\\', { metaKey: true }))).toBe(false);
        expect(typesCharacter(key('k', { ctrlKey: true, getModifierState: () => false }))).toBe(false);
        expect(typesCharacter(key('Enter'))).toBe(false);
        expect(typesCharacter(key('Escape'))).toBe(false);
        expect(typesCharacter(key('a', { isComposing: true }))).toBe(false);
    });
});
