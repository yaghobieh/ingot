import { describe, expect, it } from 'vitest';
import { projectHeaderLabel } from './project-label.utils';

describe('project header label (IDEA-93)', () => {
    it('shows only the project name', () => {
        expect(projectHeaderLabel('Explorer: ingot (Workspace)', 'Explorer', 'Project')).toBe('ingot');
        expect(projectHeaderLabel('Explorer: sample-project', 'Explorer', 'Project')).toBe('sample-project');
        expect(projectHeaderLabel('Explorer', 'Explorer', 'Project')).toBe('Project');
        expect(projectHeaderLabel('Search', 'Explorer', 'Project')).toBe('Search');
    });
});
