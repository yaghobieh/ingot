import { describe, expect, it } from 'vitest';
import { ruleFromFile } from '../project-config/project-config.utils';
import { parseAgentHooks } from '../hooks/agent-hooks.utils';
import { parseMcpJson } from '../project-config/project-config.utils';
import {
    conversionSummary, cursorTargetFor, mergeHooksJson, mergeIgnoreText, mergeMcpJson, planCursorConversion, translateHookCommand
} from './cursor-convert.utils';

const RULE = '---\ndescription: API handlers\nglobs: src/api/**\nalwaysApply: false\n---\nValidate input.';

describe('convert Cursor config into .ingot', () => {
    it('maps every Cursor file to its .ingot place (nested ones stay in their folder)', () => {
        expect(cursorTargetFor('.cursor/rules/api.mdc')?.target).toBe('.ingot/rules/api.md');
        expect(cursorTargetFor('.cursor/rules/frontend/ui.mdc')?.target).toBe('.ingot/rules/frontend/ui.md');
        expect(cursorTargetFor('packages/web/.cursor/rules/x.mdc')?.target).toBe('packages/web/.ingot/rules/x.md');
        expect(cursorTargetFor('AGENTS.md')?.target).toBe('.ingot/rules/agents.md');
        expect(cursorTargetFor('packages/web/AGENTS.md')?.target).toBe('packages/web/.ingot/rules/agents.md');
        expect(cursorTargetFor('.cursorrules')?.target).toBe('.ingot/rules/cursorrules.md');
        expect(cursorTargetFor('.cursor/commands/review.md')?.target).toBe('.ingot/commands/review.md');
        expect(cursorTargetFor('.cursor/skills/pdf/SKILL.md')).toMatchObject({ kind: 'skill', target: '.ingot/skills/pdf/SKILL.md' });
        expect(cursorTargetFor('.cursor/hooks/guard.sh')).toMatchObject({ kind: 'hookScript', target: '.ingot/hooks/guard.sh' });
        expect(cursorTargetFor('.cursor/BUGBOT.md')?.target).toBe('.ingot/BUGBOT.md');
        expect(cursorTargetFor('api/.cursor/BUGBOT.md')?.target).toBe('api/.ingot/BUGBOT.md');
        expect(cursorTargetFor('.cursor/environment.json')?.target).toBe('.ingot/environment.json');
        expect(cursorTargetFor('.cursor/extensions/x.vsix')).toBeUndefined();
    });

    it('translates rules so they load as the same kind, and AGENTS.md as an always-on rule', () => {
        const plan = planCursorConversion({ sources: [{ path: '.cursor/rules/api.mdc', text: RULE }, { path: 'AGENTS.md', text: 'Use pnpm.' }], existing: [], current: {} });
        const api = plan.steps.find(s => s.target === '.ingot/rules/api.md')!;
        const before = ruleFromFile('.cursor/rules/api.mdc', RULE, 'external');
        expect(ruleFromFile('.ingot/rules/api.md', api.text!, 'ingot')).toMatchObject({ kind: before.kind, globs: before.globs, description: before.description, body: before.body });
        const agents = plan.steps.find(s => s.from === 'AGENTS.md')!;
        expect(ruleFromFile('.ingot/rules/agents.md', agents.text!, 'ingot')).toMatchObject({ kind: 'always', body: 'Use pnpm.' });
    });

    it('never overwrites an .ingot file (a rule matches whatever its extension) and copies scripts as is', () => {
        const plan = planCursorConversion({
            sources: [{ path: '.cursor/rules/api.mdc', text: RULE }, { path: '.cursor/commands/review.md', text: 'Review.' }, { path: '.cursor/hooks/guard.sh' }],
            existing: ['.ingot/rules/api.mdc'], current: {}
        });
        expect(plan.steps.map(s => s.target)).toEqual(['.ingot/commands/review.md', '.ingot/hooks/guard.sh']);
        expect(plan.steps[1].text).toBeUndefined();
    });

    it('merges mcp.json: Cursor servers are added, .ingot servers win, unknown keys stay', () => {
        const cursor = JSON.stringify({ mcpServers: { db: { command: 'npx', args: ['db'], envFile: '.env' }, docs: { url: 'https://d.dev/mcp' } } });
        const merged = mergeMcpJson(cursor, JSON.stringify({ mcpServers: { docs: { url: 'https://mine.dev/mcp' } } }));
        expect(merged.added).toEqual(['db']);
        const servers = parseMcpJson(merged.text!, 'ingot');
        expect(servers.find(s => s.name === 'docs')?.url).toBe('https://mine.dev/mcp');
        expect(servers.find(s => s.name === 'db')).toMatchObject({ command: 'npx', envFile: '.env' });
        expect(mergeMcpJson('{', undefined).error).toContain('.cursor/mcp.json');
        expect(mergeMcpJson(cursor, undefined).added).toEqual(['db', 'docs']);
    });

    it('merges hooks.json: commands point at the copied scripts and git stages stay', () => {
        const cursor = JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: './.cursor/hooks/guard.sh', timeout: 5 }], stop: ['echo done'] } });
        const ingot = JSON.stringify({ 'pre-commit': [{ name: 'lint', run: 'npm run lint' }], hooks: { stop: [{ command: 'echo done' }] } });
        const merged = mergeHooksJson(cursor, ingot);
        expect(merged.added).toBe(1);
        const json = JSON.parse(merged.text!) as Record<string, unknown>;
        expect(json['pre-commit']).toEqual([{ name: 'lint', run: 'npm run lint' }]);
        const parsed = parseAgentHooks(merged.text, '.ingot/hooks.json');
        expect(parsed.config.beforeShellExecution?.[0]).toMatchObject({ command: './.ingot/hooks/guard.sh', timeoutSeconds: 5 });
        expect(parsed.config.stop).toHaveLength(1);
        expect(translateHookCommand('node .cursor/hooks/a.js && .cursor/hooks/b.sh')).toBe('node .ingot/hooks/a.js && .ingot/hooks/b.sh');
        expect(mergeHooksJson(cursor, merged.text)).toEqual({ added: 0 });
    });

    it('merges ignore files: copies when new, appends only the missing patterns otherwise', () => {
        expect(mergeIgnoreText('secrets/\n', undefined, '.cursorignore')).toBe('secrets/\n');
        expect(mergeIgnoreText('secrets/\n*.pem\n# note\n', 'secrets/\n', '.cursorignore')).toBe('secrets/\n\n# From .cursorignore\n*.pem\n');
        expect(mergeIgnoreText('secrets/\n', 'secrets/\n', '.cursorignore')).toBeUndefined();
        const plan = planCursorConversion({ sources: [{ path: '.cursorignore', text: 'a/\n' }], existing: ['.ingotignore'], current: { '.ingotignore': 'b/\n' } });
        expect(plan.steps).toEqual([{ kind: 'ignore', from: '.cursorignore', target: '.ingotignore', text: 'b/\n\n# From .cursorignore\na/\n', merge: true }]);
    });

    it('reports files it cannot convert and sums up what it did', () => {
        const plan = planCursorConversion({
            sources: [
                { path: '.cursor/hooks.json', text: '{ nope' }, { path: '.cursor/rules/a.mdc', text: 'A' }, { path: '.cursor/rules/b.mdc', text: 'B' },
                { path: '.cursor/commands/c.md', text: 'C' }, { path: '.cursor/mcp.json', text: JSON.stringify({ mcpServers: { x: { command: 'x' } } }) }
            ],
            existing: [], current: {}
        });
        expect(plan.skipped).toEqual([{ from: '.cursor/hooks.json', reason: '.cursor/hooks.json is not valid JSON.' }]);
        expect(conversionSummary(plan.steps)).toBe('1 command, mcp.json and 2 rules');
        expect(conversionSummary([])).toBe('');
    });
});
