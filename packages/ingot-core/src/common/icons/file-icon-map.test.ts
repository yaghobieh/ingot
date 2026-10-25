import { describe, expect, it } from 'vitest';
import { ALL_FILE_ICONS, fileIconClass, fileIconName } from './file-icon-map';

describe('Ingot Files icon map (IDEA-106)', () => {
    it('maps common files', () => {
        expect(fileIconName('cart.ts')).toBe('typescript');
        expect(fileIconName('App.tsx')).toBe('react_ts');
        expect(fileIconName('index.js')).toBe('javascript');
        expect(fileIconName('styles.css')).toBe('css');
        expect(fileIconName('page.html')).toBe('html');
        expect(fileIconName('ci.yml')).toBe('yaml');
        expect(fileIconName('data.json')).toBe('json');
        expect(fileIconName('notes.md')).toBe('markdown');
        expect(fileIconName('logo.PNG')).toBe('image');
        expect(fileIconName('mark.svg')).toBe('svg');
    });
    it('prefers names and patterns over the extension', () => {
        expect(fileIconName('README.md')).toBe('readme');
        expect(fileIconName('AGENTS.md')).toBe('robot');
        expect(fileIconName('package.json')).toBe('nodejs');
        expect(fileIconName('tsconfig.json')).toBe('tsconfig');
        expect(fileIconName('cart.test.ts')).toBe('test-ts');
        expect(fileIconName('types.d.ts')).toBe('typescript-def');
        expect(fileIconName('vite.config.ts')).toBe('vite');
        expect(fileIconName('playwright.electron.config.ts')).toBe('playwright');
        expect(fileIconName('.env.local')).toBe('tune');
    });
    it('falls back to the plain file and folder icons', () => {
        expect(fileIconName('Procfile')).toBe('file');
        expect(fileIconName('thing.unknownext')).toBe('file');
        expect(fileIconName('whatever', true)).toBe('folder');
        expect(fileIconName('src', true)).toBe('folder-src');
        expect(fileIconName('.github', true)).toBe('folder-github');
    });
    it('builds CSS classes and lists every icon', () => {
        expect(fileIconClass('App.tsx')).toBe('ingot-ficon ingot-ficon-react-ts');
        expect(ALL_FILE_ICONS).toContain('typescript');
        expect(ALL_FILE_ICONS).toContain('folder-src');
        expect(new Set(ALL_FILE_ICONS).size).toBe(ALL_FILE_ICONS.length);
    });
});
