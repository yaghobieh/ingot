import { describe, expect, it } from 'vitest';
import { LIBRARY_STRUCTURE_OPTIONS } from './library-app.consts';
import { libraryFiles, libraryNudge, libraryPathError, nodeStructureFromTree, parseLibraryPrompt, reactStructureFromTree } from './library-app';

describe('library app prompt', () => {
    it('treats unnamed structures as something to ask about', () => {
        const parsed = parseLibraryPrompt('Create for me a new React and Node.js project with full APIs for a library, use structure X for React and Node.js structure Y, open it at path /tmp/library-z');
        expect(parsed).toMatchObject({ path: '/tmp/library-z', ambiguous: true });
        expect(parsed?.react).toBeUndefined();
        expect(parsed?.node).toBeUndefined();
        expect(libraryNudge(parsed!)).toContain('ingot/ask_user');
        expect(libraryNudge(parsed!)).toContain(LIBRARY_STRUCTURE_OPTIONS[0]);
    });

    it('reads named presets and an absolute path', () => {
        const parsed = parseLibraryPrompt('Create a new React and Node.js library using feature-folders for React and a layered Node API, open it at path /tmp/ingot-lib');
        expect(parsed).toMatchObject({ path: '/tmp/ingot-lib', react: 'feature-folders', node: 'layered', ambiguous: false });
        expect(libraryNudge(parsed!)).toContain('ingot/create_library');
    });

    it('keeps example folders when the preset is not named', () => {
        const parsed = parseLibraryPrompt('Create a new React and Node.js library, use structure /tmp/sample-react/features for React and Node.js structure /tmp/sample-node/controllers, open it at /tmp/out');
        expect(parsed?.reactExample).toContain('/tmp/sample-react/features');
        expect(parsed?.nodeExample).toContain('/tmp/sample-node/controllers');
        expect(reactStructureFromTree(['src/features/books/Books.tsx'])).toBe('feature-folders');
        expect(reactStructureFromTree(['src/atoms/Label.tsx'])).toBe('atomic');
        expect(nodeStructureFromTree(['src/controllers/library.ts'])).toBe('layered');
        expect(nodeStructureFromTree(['src/modules/books/books.ts'])).toBe('modular');
    });

    it('refuses a filesystem root', () => {
        expect(libraryPathError('/tmp')).toMatch(/Refusing/);
        expect(libraryPathError('/tmp/library')).toBeUndefined();
    });

    it('writes both layouts with a library API and tests', () => {
        const files = libraryFiles({ path: '/tmp/library', react: 'atomic', node: 'modular' });
        const paths = files.map(entry => entry.path);
        expect(paths).toContain('client/src/atoms/Label.tsx');
        expect(paths).toContain('client/src/pages/LibraryPage.tsx');
        expect(paths).toContain('server/src/modules/loans/loans.ts');
        expect(paths).toContain('server/src/app.test.ts');
        expect(paths).toContain('client/src/App.test.tsx');
        const rules = files.find(entry => entry.path.endsWith('rules.ts'))?.content ?? '';
        expect(rules).toContain('borrow');
        expect(rules).toContain('returnLoan');
        const layered = libraryFiles({ path: '/tmp/library', react: 'feature-folders', node: 'layered' }).map(entry => entry.path);
        expect(layered).toContain('client/src/features/books/Books.tsx');
        expect(layered).toContain('server/src/controllers/library-controller.ts');
        expect(layered).toContain('server/src/services/library-service.ts');
        expect(layered).toContain('server/src/repositories/memory-repository.ts');
    });
});
