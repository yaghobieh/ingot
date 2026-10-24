import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, catalogToConfig, isValidServerName, rowGroup, rowSummary } from './mcp-catalog';
import { expandArgs, parseMcpJson, toMcpJson } from '../project-config/project-config.utils';

describe('MCP catalog', () => {
    it('covers the main services with unique ids', () => {
        const ids = MCP_CATALOG.map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(expect.arrayContaining(['github', 'atlassian', 'slack', 'postgres', 'linear', 'notion', 'figma', 'sentry', 'filesystem', 'browser']));
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
