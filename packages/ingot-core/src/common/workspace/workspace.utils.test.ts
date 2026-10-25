import { describe, expect, it } from 'vitest';
import { createWorkspaceFile, isWorkspaceFileName, projectDisplayName } from './workspace.utils';

describe('workspace utils', () => {
    it('recognises Ingot, VS Code and Theia workspace files', () => {
        expect(isWorkspaceFileName('/a/team.ingot-workspace')).toBe(true);
        expect(isWorkspaceFileName('/a/team.code-workspace')).toBe(true);
        expect(isWorkspaceFileName('/a/team.theia-workspace')).toBe(true);
        expect(isWorkspaceFileName('/a/team')).toBe(false);
        expect(isWorkspaceFileName('/a/.ingot-workspace')).toBe(false);
        expect(isWorkspaceFileName('/a/workspace.json')).toBe(false);
    });

    it('derives display names for folders and workspace files', () => {
        expect(projectDisplayName('/Users/me/web/')).toBe('web');
        expect(projectDisplayName('/Users/me/team.ingot-workspace')).toBe('team');
        expect(projectDisplayName('/Users/me/my.app.code-workspace')).toBe('my.app');
    });

    it('creates a multi-root workspace file without duplicate folders', () => {
        expect(createWorkspaceFile(['web', 'api', 'web'])).toEqual({ folders: [{ path: 'web' }, { path: 'api' }], settings: {} });
    });
});
