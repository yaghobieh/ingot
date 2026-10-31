import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { IngotRulesInsightService } from './ingot-rules-insight-service';
import { listProjectFiles, readGlobalRules } from './project-files';

const write = (root: string, rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
};

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, env: GIT_ENV, stdio: 'pipe' });

describe('IngotRulesInsightService', () => {
    let root: string;
    let config: string;
    let service: IngotRulesInsightService;

    beforeAll(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-rules-')));
        config = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-config-'));
        write(root, 'AGENTS.md', 'Be brief.\n');
        write(root, '.ingot/rules/style.md', '---\nalwaysApply: true\n---\nUse tabs for indentation.\n');
        write(root, '.ingot/rules/ts.md', '---\nglobs: ["src/**/*.ts", "missing/**"]\n---\nPrefer interfaces.\n');
        write(root, 'packages/web/.ingot/rules/style.md', '---\nalwaysApply: true\n---\nUse spaces for indentation.\n');
        write(root, 'packages/web/package.json', '{}');
        write(root, 'src/index.ts', 'export {};\n');
        write(root, '.gitignore', 'dist/\n');
        write(root, 'dist/out.js', '');
        write(config, 'rules/me.md', '---\nalwaysApply: true\n---\nAnswer in English.\n');
        git(root, 'init', '-q');
        git(root, 'add', '.');
        git(root, 'commit', '-q', '-m', 'Add rules');
        write(root, '.ingot/rules/ts.md', '---\nglobs: ["src/**/*.ts", "missing/**"]\n---\nPrefer interfaces over types.\n');
        service = new IngotRulesInsightService();
        Object.assign(service, { env: { getConfigDirUri: async () => FileUri.create(config).toString() } as Partial<EnvVariablesServer> });
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(config, { recursive: true, force: true });
    });

    it('lists project files with gitignore applied', async () => {
        const files = await listProjectFiles(root);
        expect(files).toContain('src/index.ts');
        expect(files).toContain('packages/web/.ingot/rules/style.md');
        expect(files).not.toContain('dist/out.js');
    });

    it('reads global rules from the config folder', () => {
        expect(readGlobalRules(config).map(f => f.path)).toEqual(['~/.ingot/rules/me.md']);
        expect(readGlobalRules(undefined)).toEqual([]);
    });

    it('runs the doctor over root, nested and global rules', async () => {
        const report = await service.doctor(root);
        expect(report.rules.map(r => r.path)).toEqual(expect.arrayContaining(['~/.ingot/rules/me.md', '.ingot/rules/style.md', 'packages/web/.ingot/rules/style.md']));
        expect(report.findings.some(f => f.code === 'dead-glob' && f.path === '.ingot/rules/ts.md')).toBe(true);
        expect(report.findings.some(f => f.code === 'override')).toBe(true);
    });

    it('shows the effective rules of a nested file with overrides', async () => {
        const effective = await service.effective(root, 'packages/web/src/app.ts');
        const rootStyle = effective.entries.find(e => e.path === '.ingot/rules/style.md');
        expect(rootStyle?.status).toBe('overridden');
        expect(rootStyle?.overriddenBy).toBe('packages/web/.ingot/rules/style.md');
        await expect(service.effective(root, '../outside.ts')).rejects.toThrow('outside the project');
    });

    it('reads git provenance and flags uncommitted changes', async () => {
        const style = await service.provenance(root, '.ingot/rules/style.md');
        expect(style.lastCommit).toMatchObject({ author: 'Ada Lovelace', subject: 'Add rules' });
        expect(style.firstCommit?.sha).toBe(style.lastCommit?.sha);
        expect(style.uncommitted).toBe(false);
        expect((await service.provenance(root, '.ingot/rules/ts.md')).uncommitted).toBe(true);
        expect((await service.provenance(root, '~/.ingot/rules/me.md')).sourceLabel).toBeTruthy();
    });

    it('sees a new file once the cached file list is dropped', async () => {
        const deadGlob = async () => (await service.doctor(root)).findings.some(f => f.code === 'dead-glob' && f.path === '.ingot/rules/ts.md');
        expect(await deadGlob()).toBe(true);
        write(root, 'missing/found.ts', 'export {};\n');
        expect(await deadGlob()).toBe(true);
        await service.invalidateFiles(root);
        expect(await deadGlob()).toBe(false);
        fs.rmSync(path.join(root, 'missing'), { recursive: true, force: true });
        await service.invalidateFiles(root);
    });

    it('rejects a missing project folder', async () => {
        await expect(service.doctor(path.join(root, 'nope'))).rejects.toThrow('Not a project folder');
    });
});
