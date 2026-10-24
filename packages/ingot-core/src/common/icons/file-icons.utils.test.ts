import { describe, expect, it } from 'vitest';
import { fileIconClasses, fileIconFor } from './file-icons.utils';

describe('Ingot file icons', () => {
    it('maps names, extensions and folders', () => {
        expect(fileIconFor('package.json', false).kind).toBe('npm');
        expect(fileIconFor('App.TSX', false).kind).toBe('ts');
        expect(fileIconFor('.env.local', false).kind).toBe('secret');
        expect(fileIconFor('weird', false).kind).toBe('default');
        expect(fileIconFor('src', true).kind).toBe('src');
        expect(fileIconFor('lib', true).kind).toBe('folder');
        expect(fileIconClasses(fileIconFor('a.md', false))).toBe('codicon codicon-markdown ingot-fi ingot-fi-doc');
    });
});

describe('Ingot badges', () => {
    it('gives text badges to files and nothing to folders', async () => {
        const { badgeClasses, BADGE_TEXT, fileBadgeFor } = await import('./file-icons.utils');
        expect(badgeClasses('useCart.ts', false)).toBe('ingot-fbadge ingot-fbadge-ts ingot-fi-ts');
        expect(badgeClasses('package.json', false)).toBe('ingot-fbadge ingot-fbadge-npm ingot-fi-npm');
        expect(badgeClasses('AGENTS.md', false)).toContain('ingot-fbadge-agent');
        expect(badgeClasses('hooks', true)).toBe('ingot-fbadge-none');
        expect(BADGE_TEXT[fileBadgeFor('data.json').slug]).toBe('{ }');
        expect(fileBadgeFor('weird').slug).toBe('file');
    });
});
