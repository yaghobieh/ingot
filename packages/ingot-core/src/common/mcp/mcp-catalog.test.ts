import { describe, expect, it } from 'vitest';
import { EMPTY_SERVER_FORM, MCP_CATALOG, catalogEntryFor, catalogToConfig, configToForm, customToConfig, isValidServerName, matchesQuery, rowGroup, rowSummary, newItemFile, splitArgs } from './mcp-catalog';
import { expandArgs, parseMcpJson, scopeLabel, toMcpJson } from '../project-config/project-config.utils';

describe('MCP catalog', () => {
    it('covers the main services with unique ids', () => {
        const ids = MCP_CATALOG.map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(expect.arrayContaining(['github', 'gitlab', 'atlassian', 'linear', 'slack', 'notion', 'figma', 'postgres', 'supabase', 'neon', 'sentry', 'vercel', 'stripe', 'resend', 'discord', 'google-drive', 'gmail', 'playwright', 'docker', 'filesystem', 'fetch', 'memory']));
    });

    it('keeps secrets out of the config and round-trips through mcp.json as keychain placeholders', () => {
        const slack = MCP_CATALOG.find(e => e.id === 'slack')!;
        const config = catalogToConfig(slack, 'slack', 'user', { SLACK_BOT_TOKEN: 'xoxb-secret', SLACK_TEAM_ID: 'T1' });
        expect(config.env).toEqual({ SLACK_TEAM_ID: 'T1' });
        expect(config.secretEnv).toEqual(['SLACK_BOT_TOKEN']);
        const json = toMcpJson([config]);
        expect(json).not.toContain('xoxb-secret');
        expect(json).toContain('"SLACK_BOT_TOKEN": "${keychain}"');
        const [back] = parseMcpJson(json, 'user');
        expect(back.secretEnv).toEqual(['SLACK_BOT_TOKEN']);
        expect(back.env).toEqual({ SLACK_TEAM_ID: 'T1' });
    });

    it('expands ${VAR} arguments from the resolved env', () => {
        expect(expandArgs(['-y', 'pg', '${POSTGRES_URL}', '${MISSING}'], { POSTGRES_URL: 'postgresql://x' })).toEqual(['-y', 'pg', 'postgresql://x', '${MISSING}']);
    });

    it('groups and summarizes rows like the reference page', () => {
        expect(rowGroup(false, undefined)).toBe('available');
        expect(rowGroup(true, { name: 'a', state: 'error', tools: [] })).toBe('attention');
        expect(rowGroup(true, { name: 'a', state: 'needs-auth', tools: [] })).toBe('attention');
        expect(rowGroup(true, { name: 'a', state: 'connected', tools: [] })).toBe('connected');
        const tools = [{ name: 'x' }, { name: 'y' }];
        expect(rowSummary(true, { name: 'a', state: 'connected', tools, resources: 4 })).toBe('2 tools, 4 resources enabled');
        expect(rowSummary(true, { name: 'a', state: 'connected', tools: [{ name: 'x' }] })).toBe('1 tool enabled');
        expect(rowSummary(true, { name: 'a', state: 'error', tools: [] })).toBe('Error - Show Output');
        expect(rowSummary(true, { name: 'a', state: 'needs-auth', tools: [] })).toBe('Needs authentication');
    });

    it('validates server names', () => {
        expect(isValidServerName('jira-api')).toBe(true);
        expect(isValidServerName('../x')).toBe(false);
        expect(isValidServerName('')).toBe(false);
    });
});

describe('catalogEntryFor / matchesQuery', () => {
    it('finds the catalog entry by id or by command + package', () => {
        expect(catalogEntryFor({ name: 'gh', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })?.id).toBe('github');
        expect(catalogEntryFor({ name: 'postgres', command: 'node', args: [] })?.id).toBe('postgres');
        expect(catalogEntryFor({ name: 'mine', command: 'node', args: ['server.js'] })).toBeUndefined();
    });
    it('matches queries case-insensitively, empty matches all', () => {
        expect(matchesQuery('', 'x')).toBe(true);
        expect(matchesQuery('GIT', 'github')).toBe(true);
        expect(matchesQuery('slack', 'github', undefined)).toBe(false);
    });
});

describe('custom server form', () => {
    it('splits args with quotes', () => {
        expect(splitArgs('node "my server.js" --port 3000 \'\'')).toEqual(['node', 'my server.js', '--port', '3000', '']);
    });
    it('stdio: secret env goes to the keychain and only a placeholder to mcp.json', () => {
        const { config, secrets } = customToConfig({ ...EMPTY_SERVER_FORM, name: 'calc', command: 'node', args: 'calc.mjs',
            env: [{ key: 'MODE', value: 'e2e', secret: false }, { key: 'TOKEN', value: 's3cret', secret: true }] }, 'project');
        expect(config).toMatchObject({ name: 'calc', source: 'ingot', command: 'node', args: ['calc.mjs'], env: { MODE: 'e2e' }, secretEnv: ['TOKEN'] });
        expect(secrets).toEqual({ TOKEN: 's3cret' });
        const json = toMcpJson([config]);
        expect(json).not.toContain('s3cret');
        expect(json).toContain('${keychain}');
    });
    it('http: secret headers are keychain placeholders and round-trip through mcp.json', () => {
        const { config, secrets } = customToConfig({ ...EMPTY_SERVER_FORM, name: 'api', transport: 'http', url: 'https://x.dev/mcp',
            headers: [{ key: 'Authorization', value: 'Bearer abc', secret: true }, { key: 'X-Team', value: 't1', secret: false }] }, 'user');
        expect(config).toMatchObject({ url: 'https://x.dev/mcp', headers: { 'X-Team': 't1' }, secretHeaders: ['Authorization'] });
        expect(secrets).toEqual({ 'header:Authorization': 'Bearer abc' });
        const parsed = parseMcpJson(toMcpJson([config]), 'user')[0];
        expect(parsed.secretHeaders).toEqual(['Authorization']);
        expect(parsed.headers).toEqual({ 'X-Team': 't1' });
    });
    it('http + OAuth runs through mcp-remote and edits back into the same form', () => {
        const { config } = customToConfig({ ...EMPTY_SERVER_FORM, name: 'n', transport: 'http', oauth: true, url: 'https://mcp.notion.com/mcp' }, 'user');
        expect(config.args).toEqual(['-y', 'mcp-remote', 'https://mcp.notion.com/mcp']);
        expect(configToForm(config)).toMatchObject({ transport: 'http', oauth: true, url: 'https://mcp.notion.com/mcp' });
    });
});

describe('scopeLabel', () => {
    it('labels Global, Imported and Project', () => {
        expect(scopeLabel('global')).toBe('Global');
        expect(scopeLabel('user')).toBe('Global');
        expect(scopeLabel('external')).toBe('Imported');
        expect(scopeLabel('global-imported')).toBe('Imported');
        expect(scopeLabel('ingot')).toBe('Project');
    });
});

describe('newItemFile', () => {
    it('places each kind in its folder with front matter', () => {
        expect(newItemFile('rule', 'style').path).toEqual(['rules', 'style.md']);
        expect(newItemFile('skill', 'deploy').path).toEqual(['skills', 'deploy', 'SKILL.md']);
        expect(newItemFile('skill', 'deploy').content).toContain('name: deploy');
        expect(JSON.parse(newItemFile('hook', 'fmt').content)).toEqual({ event: 'afterEdit', command: '' });
    });
});
