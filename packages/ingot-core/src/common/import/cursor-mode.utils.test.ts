import { describe, expect, it } from 'vitest';
import {
    agentHookFileNames, agentIgnoreFileNames, cursorModeFor, cursorModesText, effectiveCursorMode, indexIgnoreFileNames, parseCursorModes, readsCursor,
    shouldAskCursorMode, workspaceKey
} from './cursor-mode.utils';

describe('cursor mode per workspace', () => {
    it('stores and forgets one answer per workspace root, whatever the slashes', () => {
        const first = parseCursorModes(cursorModesText({}, '/work/shop/', 'convert'));
        expect(first).toEqual({ '/work/shop': 'convert' });
        const second = parseCursorModes(cursorModesText(first, 'C:\\work\\api', 'keep'));
        expect(cursorModeFor(second, '/work/shop')).toBe('convert');
        expect(cursorModeFor(second, 'C:/work/api/')).toBe('keep');
        expect(parseCursorModes(cursorModesText(second, '/work/shop', undefined))).toEqual({ 'C:/work/api': 'keep' });
        expect(workspaceKey('/')).toBe('/');
    });

    it('drops malformed files and unknown answers', () => {
        expect(parseCursorModes('not json')).toEqual({});
        expect(parseCursorModes(undefined)).toEqual({});
        expect(parseCursorModes(JSON.stringify({ version: 1, workspaces: { '/a': 'bogus', '/b': 'off' } }))).toEqual({ '/b': 'off' });
    });

    it('reads Cursor files live only in keep (or before the question was answered)', () => {
        expect(effectiveCursorMode(undefined)).toBe('keep');
        expect(readsCursor(undefined)).toBe(true);
        expect(readsCursor('keep')).toBe(true);
        expect(readsCursor('convert')).toBe(false);
        expect(readsCursor('off')).toBe(false);
        expect(agentIgnoreFileNames('keep')).toEqual(['.ingotignore', '.cursorignore']);
        expect(agentIgnoreFileNames('convert')).toEqual(['.ingotignore']);
        expect(indexIgnoreFileNames('off')).toEqual(['.ingotindexingignore']);
        expect(agentHookFileNames(undefined)).toEqual(['.cursor/hooks.json', '.ingot/hooks.json']);
        expect(agentHookFileNames('off')).toEqual(['.ingot/hooks.json']);
    });

    it('asks only for an unanswered workspace with Cursor files while the question is on', () => {
        expect(shouldAskCursorMode(2, undefined, true)).toBe(true);
        expect(shouldAskCursorMode(0, undefined, true)).toBe(false);
        expect(shouldAskCursorMode(2, 'keep', true)).toBe(false);
        expect(shouldAskCursorMode(2, undefined, false)).toBe(false);
    });
});
