import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { inflateRawSync } from 'zlib';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    addBlock, applyOrgMarks, defaultRangeFor, emptyLock, integrityOf, LATEST_RANGE, LOCK_FILE, orgPlan, packForPath, parseLock, parsePackSpec,
    removalBlock, serializeLock, specFromId, STORE_PATHS, verifyLock, withoutPack, withPack
} from '../common/ingot-kit';
import type { LockedPack, LockIssue, PackLock, PackSource, PackSpec, PackVersionsResponse, TeamPacksResponse } from '../common/ingot-kit';
import { readZipEntries } from '../common/theme/zip.utils';
import { ideHeaders } from '../common/account/gateway.utils';
import { PRODUCT } from '../common/product.consts';
import {
    PACK_DOWNLOAD_TIMEOUT_MS, PACK_FILE_MODE_READ_ONLY, PACK_FILE_MODE_WRITABLE, PACK_MAX_ARCHIVE_BYTES, PACK_USER_AGENT
} from '../common/rule-packs/rule-packs.consts';
import type { RulePackResult, RulePacksService, RulePackVersions, TeamPacksResult } from '../common/rule-packs/rule-packs.types';
import { pickPackVersion, planArchive } from '../common/rule-packs/rule-packs.utils';
import { IngotAccountBackend } from './account/ingot-account-backend';

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

class PackError extends Error { }

/**
 * IDEA-322: installs Store rule packs into a project's `.ingot/` folder and keeps `.ingot/ingot-lock.json`, like
 * `ingot add @acme/react-rules@^2`. Org packs come from the signed-in account's team; enforced ones are written read-only.
 */
@injectable()
export class IngotRulePacksService implements RulePacksService {

    @inject(IngotAccountBackend) protected readonly account: IngotAccountBackend;

    protected async store(): Promise<string> {
        return (await this.account.urls()).portalUrl.replace(/\/$/, '');
    }

    protected async get(url: string, token?: string): Promise<Response> {
        let response: Response;
        try {
            response = await fetch(url, {
                headers: { Accept: 'application/json', 'User-Agent': PACK_USER_AGENT, ...ideHeaders(PRODUCT.version), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                signal: AbortSignal.timeout(PACK_DOWNLOAD_TIMEOUT_MS)
            });
        } catch (error) {
            throw new PackError(`Could not reach the Store (${new URL(url).origin}): ${error instanceof Error ? error.message : 'network error'}`);
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string };
            throw new PackError(`The Store refused ${new URL(url).pathname} (${response.status} ${body.error ?? 'error'}).`);
        }
        return response;
    }

    async lock(root: string): Promise<PackLock> {
        const text = await fs.promises.readFile(path.join(root, LOCK_FILE), 'utf8').catch(() => undefined);
        return text === undefined ? emptyLock() : parseLock(text);
    }

    protected async writeLock(root: string, lock: PackLock): Promise<void> {
        const file = path.join(root, LOCK_FILE);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, serializeLock(lock), 'utf8');
    }

    protected spec(text: string): PackSpec {
        const spec = parsePackSpec(text);
        if (!spec) {
            throw new PackError(`"${text}" is not a pack: use @publisher/name, optionally @<range> (e.g. @acme/react-rules@^2).`);
        }
        return spec;
    }

    protected async fetchVersions(spec: PackSpec): Promise<PackVersionsResponse> {
        const url = `${await this.store()}${STORE_PATHS.versions(spec.id)}?range=${encodeURIComponent(spec.range)}`;
        return await (await this.get(url)).json() as PackVersionsResponse;
    }

    async versions(text: string): Promise<RulePackVersions> {
        const spec = this.spec(text);
        const info = await this.fetchVersions(spec);
        return { id: info.id, latest: info.latest, versions: info.versions, resolved: pickPackVersion(info, spec.range) };
    }

    protected async removeFile(file: string): Promise<void> {
        await fs.promises.chmod(file, PACK_FILE_MODE_WRITABLE).catch(() => undefined);
        await fs.promises.rm(file, { force: true });
    }

    /** Downloads one exact version, checks it and writes its files; the lockfile is written by the caller. */
    protected async installVersion(root: string, lock: PackLock, spec: PackSpec, version: string, options: { enforced: boolean; source: PackSource; integrity?: string; force?: boolean }): Promise<LockedPack> {
        const resolved = `${await this.store()}${STORE_PATHS.download(spec.id, version)}`;
        const bytes = new Uint8Array(await (await this.get(resolved)).arrayBuffer());
        if (bytes.byteLength > PACK_MAX_ARCHIVE_BYTES) {
            throw new PackError(`${spec.key}@${version} is larger than ${PACK_MAX_ARCHIVE_BYTES} bytes.`);
        }
        const integrity = integrityOf(sha256(bytes));
        if (options.integrity && options.integrity !== integrity) {
            throw new PackError(`${spec.key}@${version} does not match the lockfile (expected ${options.integrity}, got ${integrity}).`);
        }
        const raw = await readZipEntries(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, () => true, async data => inflateRawSync(data));
        const entries = new Map([...raw].map(([name, data]) => [name, Buffer.from(data).toString('utf8')]));
        const plan = planArchive(spec, version, entries);
        if ('error' in plan) {
            throw new PackError(plan.error);
        }
        for (const file of plan.files) {
            const owner = packForPath(lock, file.path);
            if (owner && owner.key !== spec.key) {
                throw new PackError(`${file.path} already belongs to ${owner.key}.`);
            }
            if (!owner && !options.force && fs.existsSync(path.join(root, file.path))) {
                throw new PackError(`${file.path} already exists and is not from a pack. Rename it first.`);
            }
        }
        const keep = new Set(plan.files.map(file => file.path));
        for (const old of lock.packs[spec.key]?.files ?? []) {
            if (!keep.has(old)) {
                await this.removeFile(path.join(root, old));
            }
        }
        for (const file of plan.files) {
            const full = path.join(root, file.path);
            await fs.promises.mkdir(path.dirname(full), { recursive: true });
            await this.removeFile(full);
            await fs.promises.writeFile(full, file.content, 'utf8');
            if (options.enforced) {
                await fs.promises.chmod(full, PACK_FILE_MODE_READ_ONLY);
            }
        }
        return {
            id: spec.id, range: spec.range === LATEST_RANGE ? defaultRangeFor(version) : spec.range, version, resolved, integrity,
            enforced: options.enforced, source: options.source, type: plan.manifest.type,
            files: plan.files.map(file => file.path),
            hashes: Object.fromEntries(plan.files.map(file => [file.path, integrityOf(sha256(file.content))]))
        };
    }

    protected async addSpec(root: string, lock: PackLock, wanted: PackSpec, options: { enforced?: boolean; source?: PackSource } = {}): Promise<{ lock: PackLock; line: string }> {
        const info = await this.fetchVersions(wanted);
        const version = pickPackVersion(info, wanted.range);
        if (!version) {
            throw new PackError(`No version of ${wanted.key} matches ${wanted.range} (published: ${info.versions.map(v => v.version).join(', ') || 'none'}).`);
        }
        const block = addBlock(lock, wanted, version);
        if (block) {
            throw new PackError(block);
        }
        const current = lock.packs[wanted.key];
        const enforced = options.enforced ?? current?.enforced ?? false;
        const range = current?.enforced && options.source !== 'org' ? current.range : wanted.range;
        const pack = await this.installVersion(root, lock, { ...wanted, range }, version, { enforced, source: options.source ?? current?.source ?? 'project' });
        const verb = current ? (current.version === version ? 'Reinstalled' : `Updated ${current.version} →`) : 'Added';
        return { lock: withPack({ ...lock, registry: await this.store() }, wanted.key, pack), line: `${verb} ${wanted.key}@${version} (${pack.range}${enforced ? ', enforced' : ''}).` };
    }

    protected async run(root: string, work: (lock: PackLock) => Promise<{ lock: PackLock; message: string }>): Promise<RulePackResult> {
        const before = await this.lock(root);
        try {
            const { lock, message } = await work(before);
            await this.writeLock(root, lock);
            return { ok: true, message, lock };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error), lock: before };
        }
    }

    add(root: string, text: string): Promise<RulePackResult> {
        return this.run(root, async lock => {
            const { lock: next, line } = await this.addSpec(root, lock, this.spec(text));
            return { lock: next, message: line };
        });
    }

    remove(root: string, key: string): Promise<RulePackResult> {
        return this.run(root, async lock => {
            const block = removalBlock(lock, key);
            if (block) {
                throw new PackError(block);
            }
            for (const file of lock.packs[key].files) {
                await this.removeFile(path.join(root, file));
            }
            return { lock: withoutPack(lock, key), message: `Removed ${key}.` };
        });
    }

    install(root: string): Promise<RulePackResult> {
        return this.run(root, async lock => {
            let next = lock;
            for (const [key, pack] of Object.entries(lock.packs)) {
                const spec = specFromId(pack.id, pack.range);
                if (spec) {
                    next = withPack(next, key, await this.installVersion(root, next, spec, pack.version, { enforced: pack.enforced, source: pack.source, integrity: pack.integrity, force: true }));
                }
            }
            return { lock: next, message: `Installed ${Object.keys(lock.packs).length} pack(s) from ${LOCK_FILE}.` };
        });
    }

    update(root: string): Promise<RulePackResult> {
        return this.run(root, async lock => {
            let next = lock;
            const lines: string[] = [];
            for (const pack of Object.values(lock.packs)) {
                const spec = specFromId(pack.id, pack.range);
                if (spec) {
                    const done = await this.addSpec(root, next, spec);
                    next = done.lock;
                    lines.push(done.line);
                }
            }
            return { lock: next, message: lines.join(' ') || 'No packs to update.' };
        });
    }

    async teamPacks(): Promise<TeamPacksResult> {
        const token = await this.account.accessToken().catch(() => undefined);
        if (!token) {
            return { signedIn: false, packs: [] };
        }
        try {
            const body = await (await this.get(`${await this.store()}${STORE_PATHS.teamPacks}`, token)).json() as TeamPacksResponse;
            return { signedIn: true, team: body.team?.name, packs: body.packs ?? [] };
        } catch (error) {
            return { signedIn: true, packs: [], error: error instanceof Error ? error.message : String(error) };
        }
    }

    syncOrg(root: string): Promise<RulePackResult> {
        return this.run(root, async lock => {
            const team = await this.teamPacks();
            if (!team.signedIn) {
                throw new PackError('Sign in to your Ingot account to get your team\'s rule packs.');
            }
            if (team.error) {
                throw new PackError(team.error);
            }
            if (!team.team) {
                return { lock, message: 'Your account is not in a team, so there are no org packs.' };
            }
            const plan = orgPlan(lock, team.packs);
            let next = applyOrgMarks(lock, team.packs, plan);
            for (const want of plan.install) {
                const spec = specFromId(want.id, want.range);
                if (spec) {
                    next = (await this.addSpec(root, next, spec, { enforced: want.enforced, source: 'org' })).lock;
                }
            }
            for (const { key, enforced } of plan.mark) {
                for (const file of next.packs[key]?.files ?? []) {
                    await fs.promises.chmod(path.join(root, file), enforced ? PACK_FILE_MODE_READ_ONLY : PACK_FILE_MODE_WRITABLE).catch(() => undefined);
                }
            }
            return {
                lock: { ...next, org: { team: team.team, syncedAt: new Date().toISOString() } },
                message: `Synced ${team.packs.length} org pack(s) from team "${team.team}" (${team.packs.filter(p => p.enforced).length} enforced).`
            };
        });
    }

    async verify(root: string): Promise<readonly LockIssue[]> {
        const lock = await this.lock(root);
        const team = await this.teamPacks();
        const read = (file: string): string | undefined => {
            try {
                return fs.readFileSync(path.join(root, file), 'utf8');
            } catch {
                return undefined;
            }
        };
        return verifyLock(lock, read, sha256, team.team ? team.packs : undefined);
    }
}
