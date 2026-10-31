import { describe, expect, it } from 'vitest';
import { referenceCandidates, ruleReferences, withReferences } from './rule-references.utils';
import { activeTeamRules, parseTeamRules } from './team-rules.utils';
import { bugbotCommand, bugbotGuidance, changedPathsFromDiff, relevantBugbotFiles, uniqueBugbotFiles } from './bugbot.utils';
import { formatEnvironment, parseEnvironmentJson } from './environment.utils';
import { applicableRules, expandCommand, parseMcpJson, scopeLabel, toMcpJson } from './project-config.utils';
import { interpolateMcp, parseDotenv, resolveMcpVariables } from '../mcp/mcp-vars.utils';

describe('IDEA-287 Cursor parity', () => {
    it('finds @file references in a rule, not emails or CSS at-rules', () => {
        expect(ruleReferences('Use @service-template.ts and @src/api/base.ts.\nMail a@b.com, keep @media rules.')).toEqual(['service-template.ts', 'src/api/base.ts']);
        expect(referenceCandidates('service-template.ts', '.cursor/rules/rpc.mdc')).toEqual(['.cursor/rules/service-template.ts', 'service-template.ts']);
        expect(referenceCandidates('../../etc/passwd', '')).toEqual([]);
        expect(withReferences('Body', [{ path: 'a.ts', text: 'export {};\n' }])).toBe('Body\n\nReferenced file a.ts:\n```\nexport {};\n```');
        expect(withReferences('Body', [])).toBe('Body');
    });

    it('reads team rules from remote config; enforced ones cannot be turned off', () => {
        const rules = parseTeamRules([
            { name: 'security', body: 'No secrets in code.', enforced: true },
            { name: 'tests', content: 'Add a test.', globs: 'src/**/*.ts', description: 'Testing' },
            { name: 'empty', body: '' }, 'bogus'
        ]);
        expect(rules.map(r => [r.name, r.kind, r.source, !!r.enforced])).toEqual([['security', 'always', 'team', true], ['tests', 'auto', 'team', false]]);
        expect(activeTeamRules(rules, ['security', 'tests']).map(r => r.name)).toEqual(['security']);
        expect(applicableRules(rules, ['src/a.ts']).map(r => r.name)).toEqual(['security', 'tests']);
        expect(scopeLabel('team')).toBe('Team');
        expect(parseTeamRules(undefined)).toEqual([]);
    });

    it('BUGBOT.md: root always, nested only for changed folders, .ingot wins over .cursor', () => {
        const files = [
            { path: '.cursor/BUGBOT.md', text: 'CURSOR ROOT' }, { path: '.ingot/BUGBOT.md', text: 'INGOT ROOT' },
            { path: 'packages/api/.cursor/BUGBOT.md', text: 'API RULES' }, { path: 'packages/web/.ingot/BUGBOT.md', text: 'WEB RULES' }
        ];
        expect(uniqueBugbotFiles(files).map(f => f.path)).toEqual(['.ingot/BUGBOT.md', 'packages/api/.cursor/BUGBOT.md', 'packages/web/.ingot/BUGBOT.md']);
        const diff = 'diff --git a/packages/api/x.ts b/packages/api/x.ts\n--- a/packages/api/x.ts\n+++ b/packages/api/x.ts\n';
        expect(changedPathsFromDiff(diff)).toEqual(['packages/api/x.ts']);
        expect(relevantBugbotFiles(files, ['packages/api/x.ts']).map(f => f.text)).toEqual(['INGOT ROOT', 'API RULES']);
        const guidance = bugbotGuidance(files, diff);
        expect(guidance).toContain('API RULES');
        expect(guidance).not.toContain('WEB RULES');
        const command = bugbotCommand(files)!;
        expect(command.name).toBe('bugbot');
        expect(expandCommand('/bugbot focus on auth', [command])?.text).toContain('focus on auth');
        expect(command.body).toContain('WEB RULES');
        expect(bugbotCommand([])).toBeUndefined();
    });

    it('parses environment.json (install, start, terminals) and describes it for the agent', () => {
        const env = parseEnvironmentJson(JSON.stringify({ snapshot: 'x', install: 'npm ci', start: 'docker compose up -d', terminals: [{ name: 'web', command: 'npm run dev' }, { name: 'bad' }] }), '.cursor/environment.json')!;
        expect(env).toMatchObject({ install: 'npm ci', start: 'docker compose up -d', terminals: [{ name: 'web', command: 'npm run dev' }] });
        expect(env.errors).toEqual(['.cursor/environment.json: terminal 2 needs a "command".']);
        expect(formatEnvironment(env, '.cursor/environment.json')).toBe('Project environment (.cursor/environment.json):\n- install: `npm ci`\n- start: `docker compose up -d`\n- web: `npm run dev`');
        expect(parseEnvironmentJson('{', 'e.json')?.errors[0]).toContain('not valid JSON');
        expect(parseEnvironmentJson('', 'e.json')).toBeUndefined();
        expect(formatEnvironment(undefined, '')).toBe('');
    });

    it('fills Cursor mcp.json variables and keeps envFile through a save', () => {
        const vars = { workspaceFolder: '/work/shop', userHome: '/home/me', pathSeparator: '/', env: { TOKEN: 't0k' } };
        expect(interpolateMcp('${workspaceFolder}${/}db --home ${userHome} --name ${workspaceFolderBasename} ${env:TOKEN}${env:MISSING} ${KEEP}', vars))
            .toBe('/work/shop/db --home /home/me --name shop t0k ${KEEP}');
        const [server] = parseMcpJson(JSON.stringify({ mcpServers: { db: { command: '${userHome}/bin/db', args: ['${workspaceFolder}'], envFile: '${workspaceFolder}/.env', env: { A: '${env:TOKEN}' } } } }), 'external');
        expect(resolveMcpVariables(server, vars)).toMatchObject({ command: '/home/me/bin/db', args: ['/work/shop'], envFile: '/work/shop/.env', env: { A: 't0k' } });
        expect(parseMcpJson(toMcpJson([server]), 'ingot')[0].envFile).toBe('${workspaceFolder}/.env');
        expect(parseDotenv('# c\nA=1\nexport B="two words"\nC=\'x\' \nD=v # note\nbad line')).toEqual({ A: '1', B: 'two words', C: 'x', D: 'v' });
    });
});
