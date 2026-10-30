import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import type { AuditEntryInput } from '../common/audit/agent-audit.types';
import { IngotAgentAuditService } from './ingot-agent-audit-service';

const input = (summary: string): AuditEntryInput => ({ sessionId: 'chat-1', tool: 'ingot/run', summary, args: { command: summary }, decision: 'approved', outcome: 'ok' });

const serviceAt = (dir: string): IngotAgentAuditService => {
    const service = new IngotAgentAuditService();
    Object.assign(service, { env: { getConfigDirUri: async () => FileUri.create(dir).toString() } as unknown as EnvVariablesServer });
    return service;
};

describe('IDEA-263 agent audit service', () => {
    const dirs: string[] = [];
    afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

    it('appends chained lines, keeps counting after a restart and detects tampering', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-audit-'));
        dirs.push(dir);
        const first = serviceAt(dir);
        await Promise.all([first.append(input('npm test')), first.append(input('npm run build'))]);
        const again = serviceAt(dir);
        const third = await again.append(input('git status'));
        expect(third.seq).toBe(3);
        expect((await again.list()).map(e => e.summary)).toEqual(['npm test', 'npm run build', 'git status']);
        expect(await again.verify()).toEqual({ ok: true, count: 3 });
        const file = await again.location();
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('npm run build', 'npm run b0ild'));
        expect(await serviceAt(dir).verify()).toMatchObject({ ok: false, brokenAt: 2 });
    });
});
