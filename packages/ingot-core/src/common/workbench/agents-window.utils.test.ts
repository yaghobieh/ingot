import { describe, expect, it } from 'vitest';
import { agentsWindowUrl, isAgentsWindowUrl } from './agents-window.utils';

describe('Agents Window (IDEA-118)', () => {
    it('adds the agents flag, keeping the query and the workspace hash', () => {
        const url = agentsWindowUrl('http://localhost:3000/index.html?port=3000#/Users/me/app');
        expect(url).toBe('http://localhost:3000/index.html?port=3000&ingotWindow=agents#/Users/me/app');
        expect(isAgentsWindowUrl(new URL(url).search)).toBe(true);
    });

    it('recognizes only the agents flag', () => {
        expect(isAgentsWindowUrl('')).toBe(false);
        expect(isAgentsWindowUrl('?ingotWindow=main')).toBe(false);
        expect(isAgentsWindowUrl('?port=1&ingotWindow=agents')).toBe(true);
    });
});
