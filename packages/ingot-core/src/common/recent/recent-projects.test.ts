import { describe, expect, it } from 'vitest';
import { parseRecentProjects } from './recent-projects';

describe('parseRecentProjects', () => {
    it('maps file URIs to paths and names, de-duplicated and capped', () => {
        const json = JSON.stringify({ recentRoots: ['file:///Users/me/shop', 'file:///Users/me/My%20App', 'file:///Users/me/shop', 'file:///w/full.ingot-workspace', 'http://x'] });
        expect(parseRecentProjects(json)).toEqual([
            { path: '/Users/me/shop', label: 'shop' },
            { path: '/Users/me/My App', label: 'My App' },
            { path: '/w/full.ingot-workspace', label: 'full' }
        ]);
        expect(parseRecentProjects(json, 1)).toHaveLength(1);
    });

    it('handles Windows drive URIs and bad input', () => {
        expect(parseRecentProjects(JSON.stringify({ recentRoots: ['file:///c%3A/src/app'] }))).toEqual([{ path: 'c:/src/app', label: 'app' }]);
        expect(parseRecentProjects('nope')).toEqual([]);
        expect(parseRecentProjects('{}')).toEqual([]);
    });
});
