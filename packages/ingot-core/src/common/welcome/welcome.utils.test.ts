import { describe, expect, it } from 'vitest';
import {
    cloneTarget, isCloneUrl, parseSshTarget, projectInitials, recentProjectLabel, recentProjectLocation, repoNameFromUrl, sshArgs, toRecentProject, toRecentProjects,
    welcomePlanLabel
} from './welcome.utils';

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
});

describe('IDEA-266 empty-window welcome', () => {
    it('labels recent rows like "alloy (Workspace)" with the folder they live in', () => {
        const workspace = toRecentProject('file:///Users/john/Projects/Forge/rail/forge.ingot-workspace', '/Users/john');
        expect(recentProjectLabel(workspace)).toBe('forge (Workspace)');
        expect(recentProjectLocation(workspace)).toBe('~/Projects/Forge/rail');
        const folder = toRecentProject('file:///Users/john/Desktop/Projects/alloy', '/Users/john');
        expect(recentProjectLabel(folder)).toBe('alloy');
        expect(recentProjectLocation(folder)).toBe('~/Desktop/Projects');
        expect(recentProjectLocation({ path: '/' })).toBe('/');
    });

    it('shows the plan next to the logo', () => {
        expect(welcomePlanLabel({ signedIn: true, user: { plan: 'ultra' } })).toBe('Ultra');
        expect(welcomePlanLabel({ signedIn: true, user: {} })).toBe('Free');
        expect(welcomePlanLabel({ signedIn: false })).toBe('Not signed in');
    });

    it('parses SSH targets and builds ssh arguments', () => {
        expect(parseSshTarget('me@build.box')).toEqual({ destination: 'me@build.box' });
        expect(parseSshTarget(' ssh://me@10.0.0.4:2222 ')).toEqual({ destination: 'me@10.0.0.4', port: 2222 });
        expect(parseSshTarget('devbox')).toEqual({ destination: 'devbox' });
        expect(sshArgs({ destination: 'me@h', port: 2222 })).toEqual(['-p', '2222', 'me@h']);
        expect(sshArgs({ destination: 'me@h' })).toEqual(['me@h']);
    });

    it('rejects SSH input that ssh could read as an option or a command', () => {
        for (const bad of ['-oProxyCommand=evil', '-x@host', 'me@host; rm -rf ~', 'me@host:0', 'me@host:70000', '', 'a b']) {
            expect(parseSshTarget(bad)).toBeUndefined();
        }
    });
});
