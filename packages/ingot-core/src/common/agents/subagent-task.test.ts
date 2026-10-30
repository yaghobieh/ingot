import { describe, expect, it } from 'vitest';
import { describeAction, BUILTIN_TOOLS } from './agent-actions';
import { isTaskCall, parseTaskArgs, taskChildPrompt, taskResultText, worktreeBranch, worktreeName } from './subagent-task';
import { SUBAGENT_MARKER } from './subagent-task.consts';
import { gitArgs } from '../git/git-ops';

describe('IDEA-291 task subagents', () => {
    it('recognizes ingot/task and runs it without an approval card', () => {
        const call = { server: 'ingot', tool: 'task', args: { prompt: 'x' } };
        expect(isTaskCall(call)).toBe(true);
        expect(isTaskCall({ ...call, server: 'github' })).toBe(false);
        expect(describeAction(call)).toBeUndefined();
        expect(describeAction({ server: 'ingot', tool: 'artifact', args: {} })).toBeUndefined();
        expect(BUILTIN_TOOLS.map(t => t.name)).toEqual(expect.arrayContaining(['task', 'artifact']));
    });

    it('needs a prompt; the title falls back to the prompt and is clipped', () => {
        expect(parseTaskArgs({ description: 'Parse CSV' })).toHaveProperty('error');
        expect(parseTaskArgs({ prompt: ' Read src and   list exports ', worktree: true })).toEqual({ description: 'Read src and list exports', prompt: 'Read src and   list exports', worktree: true });
        const long = parseTaskArgs({ prompt: 'p', description: 'x'.repeat(80) });
        expect('description' in long && long.description.length).toBe(48);
        expect('worktree' in long && long.worktree).toBe(false);
    });

    it('starts the subagent with only its task (clean context) and says where it works', () => {
        const task = { description: 'Parse', prompt: 'Write src/csv.ts', worktree: true };
        const text = taskChildPrompt(task, { path: '/tmp/w/repo-x', branch: 'ingot/task-x' });
        expect(text.startsWith('Write src/csv.ts')).toBe(true);
        expect(text).toContain(SUBAGENT_MARKER);
        expect(text).toContain('branch ingot/task-x (/tmp/w/repo-x)');
        expect(taskChildPrompt({ ...task, worktree: false })).not.toContain('worktree');
    });

    it('makes a safe worktree name and branch, and git validates it', () => {
        const name = worktreeName('chat-Mx9_Ab-12');
        expect(name).toBe('chat-mx9-ab-12');
        expect(worktreeBranch(name)).toBe('ingot/task-chat-mx9-ab-12');
        expect(gitArgs({ kind: 'worktreeAdd', name, branch: worktreeBranch(name) })).toEqual(['worktree', 'add', '-b', 'ingot/task-chat-mx9-ab-12', 'chat-mx9-ab-12']);
        expect(() => gitArgs({ kind: 'worktreeAdd', name: '../up', branch: 'ingot/task-x' })).toThrow('Invalid worktree name');
    });

    it('returns a summary to the parent with status, worktree and files', () => {
        const text = taskResultText({ title: 'Parse', status: 'review', reply: 'Added the parser.', files: ['src/csv.ts'], worktree: { path: '/tmp/w', branch: 'ingot/task-x' } });
        expect(text).toBe('Subagent "Parse" done, edits wait for the user\'s review.\nWorktree: /tmp/w (branch ingot/task-x).\nFiles: src/csv.ts\nSummary:\nAdded the parser.');
        expect(taskResultText({ title: 'X', status: 'error', reply: '', files: [], error: 'boom' })).toBe('Subagent "X" error.\nError: boom\nIt gave no summary.');
    });
});
