import { describe, expect, it } from 'vitest';
import { breadcrumbs, formatCursorPosition, parseGitHead, pickRunScript } from './vcs.utils';

describe('vcs utils', () => {
    it('parses branch names and detached heads', () => {
        expect(parseGitHead('ref: refs/heads/feature/IDEA-14-new-ui\n')).toBe('feature/IDEA-14-new-ui');
        expect(parseGitHead('a'.repeat(40))).toBe('aaaaaaa');
        expect(parseGitHead('garbage')).toBeUndefined();
    });

    it('builds breadcrumbs relative to the project root', () => {
        expect(breadcrumbs('/p/ingot', 'ingot', '/p/ingot/src/app.ts')).toEqual(['ingot', 'src', 'app.ts']);
    });

    it('formats the caret like classic IDEs', () => {
        expect(formatCursorPosition(11, 5)).toBe('12:5');
    });

    it('picks the dev/start script as run configuration', () => {
        expect(pickRunScript('{"scripts":{"build":"x","dev":"y"}}')).toBe('dev');
        expect(pickRunScript('{"scripts":{"build":"x"}}')).toBe('build');
        expect(pickRunScript('{"scripts":{"postinstall":"x","build":"y","start:electron":"z"}}')).toBe('start:electron');
        expect(pickRunScript('{"scripts":{"prepare":"x","postinstall":"y"}}')).toBeUndefined();
        expect(pickRunScript('not json')).toBeUndefined();
    });
});
