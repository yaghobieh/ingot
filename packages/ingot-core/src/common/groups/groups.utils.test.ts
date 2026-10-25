import { describe, expect, it } from 'vitest';
import { cycleProject, groupFileName, groupFolderPath, isGroupFileName, isUnder } from './groups.utils';

describe('group utils', () => {
    it('checks whether a uri belongs to a project root', () => {
        expect(isUnder('file:///a/web/src/x.ts', 'file:///a/web')).toBe(true);
        expect(isUnder('file:///a/web', 'file:///a/web/')).toBe(true);
        expect(isUnder('file:///a/web-api/x.ts', 'file:///a/web')).toBe(false);
    });

    it('recognises and names group files', () => {
        expect(isGroupFileName('/a/fullstack.ingot-group')).toBe(true);
        expect(isGroupFileName('/a/fullstack.ingot-workspace')).toBe(false);
        expect(groupFileName(' Full stack / app ')).toBe('Full-stack-app.ingot-group');
        expect(groupFileName('***')).toBe('group.ingot-group');
    });

    it('stores projects relative to the group file when possible', () => {
        expect(groupFolderPath('/a', '/a/web')).toBe('web');
        expect(groupFolderPath('/a/', '/b/api')).toBe('/b/api');
    });

    it('cycles through project tabs', () => {
        expect(cycleProject(['a', 'b', 'c'], 'c', 1)).toBe('a');
        expect(cycleProject(['a', 'b', 'c'], 'a', -1)).toBe('c');
        expect(cycleProject(['a'], undefined, 1)).toBe('a');
        expect(cycleProject([], 'a', 1)).toBeUndefined();
    });
});
