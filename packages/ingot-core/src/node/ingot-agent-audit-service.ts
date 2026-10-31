import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { AUDIT_DIR, AUDIT_DIR_MODE, AUDIT_FILE, AUDIT_FILE_MODE, AUDIT_LIST_LIMIT } from '../common/audit/agent-audit.consts';
import type { AgentAuditService, AuditEntry, AuditEntryInput, AuditVerifyResult } from '../common/audit/agent-audit.types';
import { nextEntry, parseLines, verifyChain } from '../common/audit/agent-audit.utils';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * IDEA-263: the agent audit log. One JSON line per tool call in the Ingot config folder, opened for append only and
 * chained by SHA-256 so a changed or removed line shows up in `verify`. Writes are queued so lines never interleave.
 */
@injectable()
export class IngotAgentAuditService implements AgentAuditService {

    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected file?: Promise<string>;
    protected last?: Pick<AuditEntry, 'seq' | 'hash'>;
    protected queue: Promise<unknown> = Promise.resolve();

    location(): Promise<string> {
        this.file ??= this.env.getConfigDirUri().then(uri => path.join(FileUri.fsPath(uri), AUDIT_DIR, AUDIT_FILE));
        return this.file;
    }

    append(input: AuditEntryInput): Promise<AuditEntry> {
        const run = this.queue.then(() => this.write(input));
        this.queue = run.catch(() => undefined);
        return run;
    }

    protected async write(input: AuditEntryInput): Promise<AuditEntry> {
        const file = await this.location();
        await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: AUDIT_DIR_MODE });
        this.last ??= await this.readLast(file);
        const entry = nextEntry(input, this.last, new Date().toISOString(), sha256);
        await fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: AUDIT_FILE_MODE, flag: 'a' });
        this.last = { seq: entry.seq, hash: entry.hash };
        return entry;
    }

    protected async readLast(file: string): Promise<Pick<AuditEntry, 'seq' | 'hash'> | undefined> {
        const text = await fs.promises.readFile(file, 'utf8').catch(() => '');
        const last = parseLines(text).entries.pop();
        return last ? { seq: last.seq, hash: last.hash } : undefined;
    }

    async list(limit = AUDIT_LIST_LIMIT): Promise<AuditEntry[]> {
        await this.queue;
        const text = await fs.promises.readFile(await this.location(), 'utf8').catch(() => '');
        return parseLines(text).entries.slice(-limit);
    }

    async verify(): Promise<AuditVerifyResult> {
        await this.queue;
        const text = await fs.promises.readFile(await this.location(), 'utf8').catch(() => '');
        return verifyChain(text, sha256);
    }
}
