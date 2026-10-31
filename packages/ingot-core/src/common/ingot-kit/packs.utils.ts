import {
    COMMANDS_DIR, INTEGRITY_PREFIX, LATEST_RANGE, LOCKFILE_VERSION, PACK_NAME_MAX, PACK_NAME_MIN, PACK_RULE_SEPARATOR, PACK_SPEC_PATTERN,
    PUBLISHER_MAX, PUBLISHER_MIN, RULES_DIR
} from './ingot-kit.consts';
import type { LockedPack, LockIssue, OrgPack, OrgSyncPlan, PackLock, PackManifest, PackSpec, PlannedFile, RuleRef } from './ingot-kit.types';
import { isValidRange, satisfies } from './semver.utils';

const RULE_EXTENSION = /\.(md|mdc)$/i;

export const packKey = (publisher: string, name: string): string => `@${publisher}/${name}`;
export const packId = (publisher: string, name: string): string => `${publisher}.${name}`;

/** `@acme/react-rules`, `acme/react-rules` or `acme.react-rules`, each with an optional `@<range>`. */
export const parsePackSpec = (text: string): PackSpec | undefined => {
    const match = PACK_SPEC_PATTERN.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const [, publisher, name, rawRange] = match;
    const range = rawRange?.trim() || LATEST_RANGE;
    if (publisher.length < PUBLISHER_MIN || publisher.length > PUBLISHER_MAX || name.length < PACK_NAME_MIN || name.length > PACK_NAME_MAX || !isValidRange(range)) {
        return undefined;
    }
    return { publisher, name, range, key: packKey(publisher, name), id: packId(publisher, name) };
};

/** Looks like a pack spec rather than an `ingot add <kind> <name>` kind. */
export const looksLikePackSpec = (text: string | undefined): boolean => !!text && (text.startsWith('@') || /^[a-z0-9-]+[./][a-z0-9-]+/.test(text));

export const specFromId = (id: string, range: string): PackSpec | undefined => parsePackSpec(`${id}@${range}`);

export const integrityOf = (hex: string): string => `${INTEGRITY_PREFIX}${hex}`;

export const emptyLock = (): PackLock => ({ lockfileVersion: LOCKFILE_VERSION, packs: {} });

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Reads `.ingot/ingot-lock.json` leniently: unknown fields are dropped, a broken file is an empty lock. */
export const parseLock = (text: string | undefined): PackLock => {
    if (!text?.trim()) {
        return emptyLock();
    }
    try {
        const raw = JSON.parse(text) as { lockfileVersion?: unknown; registry?: unknown; packs?: unknown; org?: unknown };
        const packs: Record<string, LockedPack> = {};
        const source = raw.packs && typeof raw.packs === 'object' ? raw.packs as Record<string, Record<string, unknown>> : {};
        for (const [key, entry] of Object.entries(source)) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const str = (name: string): string => typeof entry[name] === 'string' ? entry[name] as string : '';
            const hashes = entry.hashes && typeof entry.hashes === 'object' ? Object.fromEntries(
                Object.entries(entry.hashes as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) : {};
            packs[key] = {
                id: str('id') || key.replace(/^@/, '').replace('/', '.'),
                range: str('range') || LATEST_RANGE,
                version: str('version'),
                resolved: str('resolved'),
                integrity: str('integrity'),
                enforced: entry.enforced === true,
                source: entry.source === 'org' ? 'org' : 'project',
                type: str('type') || 'rules',
                files: strings(entry.files),
                hashes
            };
        }
        const org = raw.org && typeof raw.org === 'object' ? raw.org as { team?: unknown; syncedAt?: unknown } : undefined;
        return {
            lockfileVersion: typeof raw.lockfileVersion === 'number' ? raw.lockfileVersion : LOCKFILE_VERSION,
            ...(typeof raw.registry === 'string' ? { registry: raw.registry } : {}),
            packs,
            ...(org && typeof org.team === 'string' ? { org: { team: org.team, syncedAt: typeof org.syncedAt === 'string' ? org.syncedAt : '' } } : {})
        };
    } catch {
        return emptyLock();
    }
};

/** Stable output (sorted packs and files) so the lockfile diffs cleanly in reviews. */
export const serializeLock = (lock: PackLock): string => {
    const packs = Object.fromEntries(Object.keys(lock.packs).sort().map(key => {
        const pack = lock.packs[key];
        const files = [...pack.files].sort();
        return [key, { ...pack, files, hashes: Object.fromEntries(files.filter(f => pack.hashes[f]).map(f => [f, pack.hashes[f]])) }];
    }));
    return `${JSON.stringify({ lockfileVersion: lock.lockfileVersion, ...(lock.registry ? { registry: lock.registry } : {}), ...(lock.org ? { org: lock.org } : {}), packs }, null, 2)}\n`;
};

export const withPack = (lock: PackLock, key: string, pack: LockedPack): PackLock => ({ ...lock, packs: { ...lock.packs, [key]: pack } });

export const withoutPack = (lock: PackLock, key: string): PackLock => {
    const packs = { ...lock.packs };
    delete packs[key];
    return { ...lock, packs };
};

const baseName = (path: string): string => path.split('/').pop() ?? path;

/**
 * Where an installed pack's files go: rules to `.ingot/rules/<name>--<file>` and commands to `.ingot/commands/<command>.md`
 * (the layout `ingot try` uses). `entries` holds the archive's text files by path.
 */
export const planPackFiles = (manifest: PackManifest, entries: ReadonlyMap<string, string>): PlannedFile[] => {
    const files: PlannedFile[] = [];
    for (const rule of manifest.contributes?.rules ?? []) {
        const content = entries.get(rule.path);
        if (content !== undefined) {
            files.push({ path: `${RULES_DIR}/${manifest.name}${PACK_RULE_SEPARATOR}${baseName(rule.path)}`, content });
        }
    }
    for (const command of manifest.contributes?.commands ?? []) {
        const content = entries.get(command.path);
        if (content !== undefined) {
            files.push({ path: `${COMMANDS_DIR}/${command.name}.md`, content });
        }
    }
    return files;
};

/** Refuses removing an org-enforced pack. */
export const removalBlock = (lock: PackLock, key: string): string | undefined => {
    const pack = lock.packs[key];
    if (!pack) {
        return `${key} is not installed.`;
    }
    return pack.enforced ? `${key} is enforced by your organization and cannot be removed.` : undefined;
};

/** Refuses installing an enforced pack at a version outside the org's range. */
export const addBlock = (lock: PackLock, spec: PackSpec, resolved?: string): string | undefined => {
    const pack = lock.packs[spec.key];
    if (!pack?.enforced) {
        return undefined;
    }
    if (spec.range !== LATEST_RANGE && spec.range !== pack.range && (!resolved || !satisfies(resolved, pack.range))) {
        return `${spec.key} is enforced by your organization at ${pack.range}; ${spec.range} is not allowed.`;
    }
    return undefined;
};

export const enforcedPaths = (lock: PackLock): Set<string> =>
    new Set(Object.values(lock.packs).filter(p => p.enforced).flatMap(p => p.files));

export const isEnforcedPath = (lock: PackLock, path: string): boolean => enforcedPaths(lock).has(path.replace(/^\.\//, ''));

/** The pack that wrote a file, if any. */
export const packForPath = (lock: PackLock, path: string): { key: string; pack: LockedPack } | undefined => {
    const clean = path.replace(/^\.\//, '');
    const found = Object.entries(lock.packs).find(([, pack]) => pack.files.includes(clean));
    return found ? { key: found[0], pack: found[1] } : undefined;
};

/** `react-rules--hooks.mdc` → `hooks`; `hooks.md` → `hooks`. */
export const ruleBaseName = (path: string): string => {
    const file = baseName(path).replace(RULE_EXTENSION, '');
    const at = file.indexOf(PACK_RULE_SEPARATOR);
    return at > 0 ? file.slice(at + PACK_RULE_SEPARATOR.length) : file;
};

/**
 * Project rules that try to replace an org-enforced rule (same rule name, or the same name as the rule without its
 * pack prefix). The enforced rule wins: these are dropped from the agent's rules.
 */
export const overriddenRules = <T extends RuleRef>(lock: PackLock, rules: readonly T[]): T[] => {
    const enforced = Object.values(lock.packs).filter(p => p.enforced).flatMap(p => p.files).filter(f => RULE_EXTENSION.test(f));
    if (!enforced.length) {
        return [];
    }
    const enforcedFiles = new Set(enforced);
    const names = new Set(enforced.map(ruleBaseName));
    return rules.filter(rule => !enforcedFiles.has(rule.path) && (names.has(rule.name) || names.has(ruleBaseName(rule.path))));
};

const keyOfId = (id: string): string => {
    const at = id.indexOf('.');
    return at > 0 ? packKey(id.slice(0, at), id.slice(at + 1)) : id;
};

export const orgPlan = (lock: PackLock, org: readonly OrgPack[]): OrgSyncPlan => {
    const install: OrgPack[] = [];
    const mark: { key: string; enforced: boolean }[] = [];
    const wanted = new Set<string>();
    for (const pack of org) {
        const key = keyOfId(pack.id);
        wanted.add(key);
        const current = lock.packs[key];
        if (!current || !current.version || !satisfies(current.version, pack.range)) {
            install.push(pack);
        } else if (current.enforced !== pack.enforced || current.source !== 'org' || current.range !== pack.range) {
            mark.push({ key, enforced: pack.enforced });
        }
    }
    const release = Object.entries(lock.packs).filter(([key, pack]) => pack.source === 'org' && !wanted.has(key)).map(([key]) => key);
    return { install, mark, release };
};

export const applyOrgMarks = (lock: PackLock, org: readonly OrgPack[], plan: OrgSyncPlan): PackLock => {
    let next = lock;
    for (const { key, enforced } of plan.mark) {
        const range = org.find(p => keyOfId(p.id) === key)?.range ?? lock.packs[key].range;
        next = withPack(next, key, { ...next.packs[key], enforced, source: 'org', range });
    }
    for (const key of plan.release) {
        next = withPack(next, key, { ...next.packs[key], enforced: false, source: 'project' });
    }
    return next;
};

/**
 * Checks the files on disk against the lock (`hash` returns the hex SHA-256 of a text) and, when the org list is known,
 * that every enforced pack is installed, enforced and inside its range.
 */
export const verifyLock = (lock: PackLock, read: (path: string) => string | undefined, hash: (text: string) => string, org?: readonly OrgPack[]): LockIssue[] => {
    const issues: LockIssue[] = [];
    for (const [key, pack] of Object.entries(lock.packs)) {
        for (const path of pack.files) {
            const text = read(path);
            if (text === undefined) {
                issues.push({ kind: 'missing-file', pack: key, path, message: `${path} from ${key} is missing.` });
            } else if (pack.hashes[path] && integrityOf(hash(text)) !== pack.hashes[path]) {
                issues.push({ kind: 'modified-file', pack: key, path, message: `${path} from ${key}@${pack.version} was edited${pack.enforced ? ' (org-enforced)' : ''}.` });
            }
        }
    }
    for (const want of org?.filter(p => p.enforced) ?? []) {
        const key = keyOfId(want.id);
        const pack = lock.packs[key];
        if (!pack) {
            issues.push({ kind: 'missing-enforced', pack: key, message: `${key}@${want.range} is enforced by your organization but not installed.` });
        } else if (!pack.enforced) {
            issues.push({ kind: 'not-enforced', pack: key, message: `${key} is enforced by your organization but the lockfile does not mark it enforced.` });
        } else if (!satisfies(pack.version, want.range)) {
            issues.push({ kind: 'range-mismatch', pack: key, message: `${key}@${pack.version} is outside the org range ${want.range}.` });
        }
    }
    return issues;
};
