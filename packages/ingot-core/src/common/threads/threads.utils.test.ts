import { describe, expect, it } from 'vitest';
import type { ThreadInput } from './threads.types';
import { finishedThreads, finishMessage, groupThreads, isValidWorktreeName, projectLabel, threadState, worktreeBranch, worktreeFolder, worktreeName } from './threads.utils';

const thread = (patch: Partial<ThreadInput> & { id: string }): ThreadInput => ({
    title: patch.id, status: 'idle', updatedAt: 0, messageCount: 1, running: false, unseen: false, ...patch
});

describe('IDEA-268 threads', () => {
    it('derives the sidebar state from status and the running flag', () => {
        expect(threadState('idle', true, 1)).toBe('running');
        expect(threadState('review', false, 2)).toBe('review');
        expect(threadState('approval', false, 2)).toBe('review');
        expect(threadState('error', false, 2)).toBe('error');
        expect(threadState('idle', false, 2)).toBe('done');
        expect(threadState('idle', false, 0)).toBe('idle');
    });

    it('groups threads by project, open project first and newest thread first', () => {
        const groups = groupThreads([
            thread({ id: 'a', project: 'file:///w/zeta', updatedAt: 1 }),
            thread({ id: 'b', updatedAt: 5, running: true }),
            thread({ id: 'c', updatedAt: 9, worktree: { path: 'file:///w/shop.worktrees/c', branch: 'ingot/c' } }),
            thread({ id: 'd', project: 'file:///w/alpha', updatedAt: 3 })
        ], 'file:///w/shop');
        expect(groups.map(g => g.label)).toEqual(['shop', 'alpha', 'zeta']);
        expect(groups[0].rows.map(r => [r.id, r.state, r.branch])).toEqual([['c', 'done', 'ingot/c'], ['b', 'running', undefined]]);
        expect(groupThreads([thread({ id: 'x' })], undefined)[0].label).toBe('No project');
    });

    it('reports threads that stopped running', () => {
        expect(finishedThreads(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual(['a']);
    });

    it('names worktrees from the title and id, safe for git and the file system', () => {
        expect(worktreeName('Add a books page!', 'chat-lx2k-17')).toBe('add-a-books-page-2k17');
        expect(worktreeName('???', 'chat-1')).toBe('thread-hat1');
        expect(isValidWorktreeName(worktreeName('A very long title that keeps going and going on', 'chat-abc'))).toBe(true);
        expect(isValidWorktreeName('../escape')).toBe(false);
        expect(isValidWorktreeName('-flag')).toBe(false);
        expect(worktreeBranch('fix-k17')).toBe('ingot/fix-k17');
    });

    it('puts the worktree folder next to the repo', () => {
        expect(worktreeFolder('/Users/me/shop', 'fix-1')).toBe('/Users/me/shop.worktrees/fix-1');
        expect(worktreeFolder('/Users/me/shop/', 'fix-1')).toBe('/Users/me/shop.worktrees/fix-1');
        expect(worktreeFolder('C:\\code\\shop', 'fix-1')).toBe('C:\\code\\shop.worktrees\\fix-1');
        expect(projectLabel('file:///Users/me/my%20shop')).toBe('my shop');
    });

    it('words the finish toast', () => {
        expect(finishMessage('Fix', 'done', 0)).toBe('"Fix" finished.');
        expect(finishMessage('Fix', 'review', 2)).toBe('"Fix" finished. 2 files to review.');
        expect(finishMessage('Fix', 'error', 0)).toBe('"Fix" stopped with an error.');
    });
});
