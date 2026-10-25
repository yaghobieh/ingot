import { describe, expect, it } from 'vitest';
import { projectInitials, repoNameFromUrl, toRecentProject, toRecentProjects } from './welcome.utils';

describe('welcome utils', () => {
    it('builds initials like JetBrains project icons', () => {
        expect(projectInitials('forge-mission-control')).toBe('FM');
        expect(projectInitials('atlas')).toBe('AT');
    });

    it('shortens paths under the home folder', () => {
        expect(toRecentProject('file:///Users/john/Projects/atlas', '/Users/john')).toMatchObject({ name: 'atlas', path: '~/Projects/atlas', kind: 'folder' });
        expect(toRecentProject('file:///Users/john/team.ingot-workspace', '/Users/john')).toMatchObject({ name: 'team', path: '~/team.ingot-workspace', kind: 'workspace' });
        expect(toRecentProject('file:///Users/john/fullstack.ingot-group')).toMatchObject({ name: 'fullstack', kind: 'group' });
    });

    it('dedupes and filters recent projects', () => {
        const list = toRecentProjects(['file:///a/atlas', 'file:///a/atlas', 'file:///a/ingot'], undefined, 'ing');
        expect(list.map(p => p.name)).toEqual(['ingot']);
    });

    it('derives repo names from clone URLs', () => {
        expect(repoNameFromUrl('https://github.com/yaghobieh/ingot.git')).toBe('ingot');
        expect(repoNameFromUrl('git@github.com:yaghobieh/atlas.git')).toBe('atlas');
    });
});
