import { EXTENSION_MANIFEST, EXTENSIONS_DIR, LOCK_FILE, PACK_RULE_SEPARATOR, SOURCE_LABELS } from './rules-engine.consts';
import type { CommitInfo, PackInfo, RuleDoc, RulesWorkspace } from './rules-engine.types';

/** `git log` format: sha, author, email, ISO date, subject, separated by the unit separator. */
export const GIT_LOG_FIELD_SEPARATOR = '\u001f';
export const GIT_LOG_FORMAT = ['%H', '%an', '%ae', '%aI', '%s'].join('%x1f');
const COMMIT_FIELDS = 5;

export const parseCommitLine = (line: string): CommitInfo | undefined => {
    const parts = line.trim().split(GIT_LOG_FIELD_SEPARATOR);
    if (parts.length < COMMIT_FIELDS || !parts[0]) {
        return undefined;
    }
    const [sha, author, email, date, ...subject] = parts;
    return { sha, author, email, date, subject: subject.join(GIT_LOG_FIELD_SEPARATOR) };
};

/** Newest and oldest commit of a `git log --format=GIT_LOG_FORMAT` output. */
export const parseGitLog = (output: string): { last?: CommitInfo; first?: CommitInfo } => {
    const commits = output.split('\n').map(parseCommitLine).filter((c): c is CommitInfo => !!c);
    return { ...(commits[0] ? { last: commits[0] } : {}), ...(commits.length ? { first: commits[commits.length - 1] } : {}) };
};

const splitPack = (spec: string, from: PackInfo['from']): PackInfo => {
    const at = spec.lastIndexOf('@');
    return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1), from } : { name: spec, from };
};

interface LockEntry {
    readonly name?: unknown;
    readonly version?: unknown;
    readonly files?: unknown;
    readonly rules?: unknown;
}

const lockEntries = (text: string | undefined): { name: string; version?: string; files: string[] }[] => {
    if (!text) {
        return [];
    }
    try {
        const raw = JSON.parse(text) as { packs?: unknown; packages?: unknown };
        const packs = raw.packs ?? raw.packages;
        const list: [string, LockEntry][] = Array.isArray(packs)
            ? (packs as LockEntry[]).map(p => [String(p.name ?? ''), p])
            : packs && typeof packs === 'object' ? Object.entries(packs as Record<string, LockEntry>) : [];
        return list.filter(([name]) => name).map(([name, p]) => ({
            name,
            ...(typeof p.version === 'string' ? { version: p.version } : {}),
            files: [...(Array.isArray(p.files) ? p.files : []), ...(Array.isArray(p.rules) ? p.rules : [])].map(String)
        }));
    } catch {
        return [];
    }
};

/**
 * The store pack a rule came from: frontmatter `pack`, `.ingot/ingot-lock.json`, or a pack `ingot try` installed
 * (`.ingot/rules/<name>--file.md` next to `.ingot/extensions/<publisher>.<name>/ingot.json`).
 */
export const packFor = (doc: RuleDoc, ws: Pick<RulesWorkspace, 'files' | 'read'>): PackInfo | undefined => {
    if (doc.pack) {
        return splitPack(doc.pack, 'frontmatter');
    }
    const fileName = doc.path.split('/').pop() ?? doc.path;
    const locked = lockEntries(ws.read(LOCK_FILE)).find(e => e.files.some(f => f === doc.path || f.endsWith(`/${fileName}`) || f === fileName));
    if (locked) {
        return { name: locked.name, ...(locked.version ? { version: locked.version } : {}), from: 'lockfile' };
    }
    const separator = fileName.indexOf(PACK_RULE_SEPARATOR);
    if (separator <= 0) {
        return undefined;
    }
    const packName = fileName.slice(0, separator);
    const manifest = ws.files.find(f => f.startsWith(EXTENSIONS_DIR) && f.endsWith(`.${packName}/${EXTENSION_MANIFEST}`));
    if (!manifest) {
        return undefined;
    }
    const id = manifest.slice(EXTENSIONS_DIR.length, -(EXTENSION_MANIFEST.length + 1));
    try {
        const version = (JSON.parse(ws.read(manifest) ?? '{}') as { version?: unknown }).version;
        return { name: id, ...(typeof version === 'string' ? { version } : {}), from: 'extension' };
    } catch {
        return { name: id, from: 'extension' };
    }
};

export const sourceLabel = (doc: Pick<RuleDoc, 'source' | 'scope'>): string =>
    doc.scope ? `${SOURCE_LABELS[doc.source]} · ${doc.scope}/` : SOURCE_LABELS[doc.source];

export const packLabel = (pack: PackInfo | undefined): string | undefined => pack ? (pack.version ? `${pack.name}@${pack.version}` : pack.name) : undefined;
