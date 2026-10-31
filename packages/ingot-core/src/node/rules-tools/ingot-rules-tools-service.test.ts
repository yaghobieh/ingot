import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IngotRulesToolsService } from './ingot-rules-tools-service';
import { applyWrites, listProjectFiles, writeState } from './rules-project';

let root: string;
const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
};
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-rules-tools-'));
    write('.ingot/rules/style.md', '---\ndescription: House style\nalwaysApply: true\n---\nUse tabs.\n');
    write('.ingot/rules/react.md', '---\nglobs: src/**/*.tsx\n---\nUse function components.\n');
    write('AGENTS.md', '# Shop\n\nRun `npm test`.\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('IngotRulesToolsService export', () => {
    const service = new IngotRulesToolsService();

    it('plans without bodies, applies, and is then up to date', async () => {
        const plan = await service.planExport(root);
        expect(plan.drift).toBe(true);
        expect(plan.files.every(file => file.content === undefined && file.before === undefined)).toBe(true);
        const after = await service.applyExport(root);
        expect(after.drift).toBe(false);
        expect(read('AGENTS.md')).toMatch(/^# Shop\n\nRun `npm test`\.\n/);
        expect(read('AGENTS.md')).toContain('Use tabs.');
        expect(read('.cursor/rules/react.mdc')).toContain('globs: src/**/*.tsx');
        expect(fs.existsSync(path.join(root, '.windsurf/rules/style.md'))).toBe(true);
    });

    it('limits the export to the chosen targets', async () => {
        await service.applyExport(root, ['cursor']);
        expect(fs.existsSync(path.join(root, '.cursor/rules/style.mdc'))).toBe(true);
        expect(read('AGENTS.md')).not.toContain('Use tabs.');
    });

    it('rejects a missing project folder', async () => {
        await expect(service.planExport(path.join(root, 'nope'))).rejects.toThrow('is not a folder');
    });
});

describe('rules-project', () => {
    it('never writes outside the project', () => {
        expect(() => applyWrites(root, [{ path: '../escape.md', content: 'x' }])).toThrow('outside the project');
    });

    it('keeps .ingot/.state out of the file list and out of git', () => {
        writeState(root, '.ingot/.state/rule-hits.json', '{}');
        expect(read('.ingot/.state/.gitignore')).toBe('*\n');
        expect(listProjectFiles(root)).not.toContain('.ingot/.state/rule-hits.json');
    });
});
