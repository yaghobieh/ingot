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
