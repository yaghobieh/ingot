import { describe, expect, it } from 'vitest';
import { cloneTarget, isCloneUrl, openVsxParts, projectInitials, repoNameFromUrl, toRecentProject, toRecentProjects, visibleWorkspaces } from './welcome.utils';

describe('welcome utils', () => {
    it('builds initials like classic IDEs project icons', () => {
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

    it('accepts only https, ssh and scp-style clone URLs (IDEA-165)', () => {
        expect(isCloneUrl('https://github.com/yaghobieh/ingot.git')).toBe(true);
        expect(isCloneUrl('git@github.com:yaghobieh/ingot.git')).toBe(true);
        expect(isCloneUrl('ssh://git@host/team/repo')).toBe(true);
        expect(isCloneUrl('--upload-pack=x')).toBe(false);
        expect(isCloneUrl('http://plain.example/repo')).toBe(false);
        expect(isCloneUrl('https://x.dev/a b')).toBe(false);
        expect(cloneTarget('/Users/john/Projects/', 'https://github.com/yaghobieh/ingot.git')).toBe('/Users/john/Projects/ingot');
    });

    it('limits the welcome workspaces until Show More (IDEA-165)', () => {
        expect(visibleWorkspaces([1, 2, 3, 4], false, 3)).toEqual({ shown: [1, 2, 3], more: true });
        expect(visibleWorkspaces([1, 2, 3, 4], true, 3)).toEqual({ shown: [1, 2, 3, 4], more: false });
        expect(visibleWorkspaces([1, 2], false, 3)).toEqual({ shown: [1, 2], more: false });
        expect(openVsxParts('redhat.java')).toEqual({ namespace: 'redhat', name: 'java' });
    });
});
