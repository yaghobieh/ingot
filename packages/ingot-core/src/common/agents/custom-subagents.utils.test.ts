import { describe, expect, it } from 'vitest';
import {
    findSubagent, formatSubagents, isSubagentFile, mergeSubagents, parseSubagentFile, readonlySubagentResult, subagentInstructions, subagentModel, subagentTypeArg,
    unknownSubagentError
} from './custom-subagents.utils';
import { parseTaskArgs, taskChildPrompt } from './subagent-task';
import { toolAllowedInMode } from './mode-tools';
import { BUILTIN_TOOL_SERVER } from './agent-actions';

const REVIEWER = '---\nname: Reviewer\ndescription: Reviews diffs for bugs\nmodel: gpt-5[effort=high]\nreadonly: true\nis_background: true\n---\nLook for missing awaits.';

describe('IDEA-287 custom subagents', () => {
    it('parses frontmatter; the name falls back to the file name; inherit means the lead model', () => {
        expect(parseSubagentFile('.cursor/agents/reviewer.md', REVIEWER, 'project')).toEqual({
            name: 'reviewer', description: 'Reviews diffs for bugs', model: 'gpt-5', readonly: true, background: true,
            prompt: 'Look for missing awaits.', path: '.cursor/agents/reviewer.md', scope: 'project'
        });
        expect(parseSubagentFile('~/.claude/agents/docs-writer.md', '---\nmodel: inherit\n---\nWrite docs.', 'user'))
            .toMatchObject({ name: 'docs-writer', description: '', readonly: false, background: false });
        expect(parseSubagentFile('.ingot/agents/empty.md', '---\nname: empty\n---\n', 'project')).toBeUndefined();
        expect(parseSubagentFile('.ingot/agents/x.md', '---\nname: bad name!\n---\nBody', 'project')).toBeUndefined();
        expect(subagentModel('inherit')).toBeUndefined();
        expect(subagentModel(undefined)).toBeUndefined();
        expect(subagentModel('claude-4[context=300k]')).toBe('claude-4');
        expect(isSubagentFile('a.MD')).toBe(true);
        expect(isSubagentFile('a.txt')).toBe(false);
    });

    it('later folders win on a name clash and lookups ignore case', () => {
        const user = parseSubagentFile('~/.cursor/agents/reviewer.md', '---\nname: reviewer\n---\nUser one.', 'user')!;
        const project = parseSubagentFile('.cursor/agents/reviewer.md', REVIEWER, 'project')!;
        const claude = parseSubagentFile('.claude/agents/tester.md', 'Run tests.', 'project')!;
        const merged = mergeSubagents([user], [claude], [project]);
        expect(merged.map(a => [a.name, a.scope])).toEqual([['reviewer', 'project'], ['tester', 'project']]);
        expect(findSubagent(merged, ' Reviewer ')?.prompt).toBe('Look for missing awaits.');
        expect(unknownSubagentError('nope', merged)).toBe('Unknown subagent "nope". Available: reviewer, tester.');
        expect(unknownSubagentError('nope', [])).toBe('Unknown subagent "nope". Available: none.');
        expect(formatSubagents(merged)).toContain('- reviewer (read-only): Reviews diffs for bugs');
        expect(formatSubagents(merged)).toContain('- tester: .claude/agents/tester.md');
        expect(formatSubagents([])).toBe('');
    });

    it('ingot/task takes subagent_type (or agent) and the child prompt starts with its instructions', () => {
        expect(subagentTypeArg({ subagent_type: ' Reviewer ' })).toBe('reviewer');
        expect(subagentTypeArg({ agent: 'tester' })).toBe('tester');
        expect(subagentTypeArg({})).toBeUndefined();
        const task = parseTaskArgs({ description: 'Review', prompt: 'Review src/app.ts', subagent_type: 'reviewer' });
        expect(task).toMatchObject({ agent: 'reviewer', worktree: false });
        const agent = parseSubagentFile('.cursor/agents/reviewer.md', REVIEWER, 'project')!;
        const prompt = taskChildPrompt(task as Exclude<typeof task, { error: string }>, undefined, subagentInstructions(agent));
        expect(prompt.startsWith('Your instructions as the subagent "reviewer":\nLook for missing awaits.')).toBe(true);
        expect(prompt).toContain('Review src/app.ts');
    });

    it('a read-only subagent may only read, even in Agent mode', () => {
        const read = { server: BUILTIN_TOOL_SERVER, tool: 'read_file', args: { path: 'a.ts' } };
        const run = { server: BUILTIN_TOOL_SERVER, tool: 'run', args: { command: 'rm -rf x' } };
        expect(toolAllowedInMode('agent', run)).toBe(true);
        expect(toolAllowedInMode('agent', run, true)).toBe(false);
        expect(toolAllowedInMode('agent', read, true)).toBe(true);
        expect(readonlySubagentResult('reviewer', 'ingot/run')).toContain('"reviewer" is a read-only subagent: ingot/run is not available.');
    });
});
