import {
    AGENTS_FILE, CURSOR_MERGE_KINDS, CURSOR_ROOT_SYNC_FILES, CURSOR_SYNC_CONFLICT_TEXT, CURSOR_SYNC_DIR, CURSOR_SYNC_FILE_VERSION, FNV_OFFSET, FNV_PRIME, HASH_RADIX
} from './cursor-sync.consts';
import type { CursorItemKind } from './cursor-convert.types';
import type {
    CursorSyncChange, CursorSyncConflict, CursorSyncFile, CursorSyncInput, CursorSyncManifest, CursorSyncPlan, CursorSyncRecord
} from './cursor-sync.types';

/** A content fingerprint for change detection (FNV-1a over UTF-16 code units, plus the length). */
export const hashText = (text: string): string => {
    let hash = FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return `${hash.toString(HASH_RADIX)}-${text.length.toString(HASH_RADIX)}`;
};

export const isMergeKind = (kind: CursorItemKind): boolean => CURSOR_MERGE_KINDS.includes(kind);

/** True for a workspace-relative path whose change can need a sync: `.cursor/…` (any depth), Cursor root files, AGENTS.md. */
export const isCursorSyncPath = (path: string): boolean => {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts.includes(CURSOR_SYNC_DIR) || CURSOR_ROOT_SYNC_FILES.includes(path) || parts[parts.length - 1] === AGENTS_FILE;
};

/**
 * IDEA-287: what pulling the current Cursor config into `.ingot` would do. A target follows its source only while the user
 * has not edited it since the last sync; edited targets are conflicts and stay as they are. A target the user deleted is
 * not brought back. Targets that already match are adopted (recorded) without a write.
 */
export const planCursorSync = ({ items, manifest, targets }: CursorSyncInput): CursorSyncPlan => {
    const changes: CursorSyncChange[] = [];
    const conflicts: CursorSyncConflict[] = [];
    const adopted: Record<string, CursorSyncRecord> = {};
    const forgotten: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        seen.add(item.target);
        const record = manifest[item.target];
        const current = targets[item.target];
        const desired = item.text !== undefined ? hashText(item.text) : item.sourceHash;
        const next: CursorSyncRecord = { from: item.from, source: item.sourceHash, target: desired };
        const change = (action: CursorSyncChange['action']): CursorSyncChange =>
            ({ action, from: item.from, target: item.target, kind: item.kind, ...(item.text !== undefined ? { text: item.text } : {}), record: next });
        if (current === desired) {
            if (record?.source !== item.sourceHash || record.target !== desired) {
                adopted[item.target] = next;
            }
        } else if (!record) {
            if (current === undefined) {
                changes.push(change('add'));
            }
        } else if (record.source !== item.sourceHash && current !== undefined) {
            if (current === record.target) {
                changes.push(change('update'));
            } else {
                conflicts.push({ from: item.from, target: item.target, reason: 'bothChanged' });
            }
        }
    }
    for (const [target, record] of Object.entries(manifest)) {
        if (seen.has(target)) {
            continue;
        }
        const current = targets[target];
        if (current === undefined) {
            forgotten.push(target);
        } else if (current === record.target) {
            changes.push({ action: 'remove', from: record.from, target });
        } else {
            conflicts.push({ from: record.from, target, reason: 'removedButEdited' });
        }
    }
    return { changes, conflicts, adopted, forgotten };
};

/** The manifest after applying a plan's changes (and its adopted / forgotten records). */
export const applySyncPlan = (manifest: CursorSyncManifest, plan: CursorSyncPlan, applied: readonly CursorSyncChange[] = plan.changes): CursorSyncManifest => {
    const next: Record<string, CursorSyncRecord> = { ...manifest, ...plan.adopted };
    for (const change of applied) {
        if (change.action === 'remove') {
            delete next[change.target];
        } else if (change.record) {
            next[change.target] = change.record;
        }
    }
    plan.forgotten.forEach(target => delete next[target]);
    return next;
};

/** Same pending sync as last time (so the user is not asked twice about the same change). */
export const syncSignature = (plan: CursorSyncPlan, merges: readonly string[]): string =>
    [...plan.changes.map(c => `${c.action}:${c.target}:${c.record?.source ?? ''}`), ...plan.conflicts.map(c => `conflict:${c.target}`), ...merges.map(m => `merge:${m}`)]
        .sort().join('|');

const count = (n: number, one: string, many = one): string => `${n} ${n === 1 ? one : many}`;

/** "2 updated, 1 new, 1 removed and .ingot/mcp.json merged". */
export const syncSummary = (changes: readonly CursorSyncChange[], merges: readonly string[]): string => {
    const by = (action: CursorSyncChange['action']): number => changes.filter(c => c.action === action).length;
    const parts = [
        by('update') ? `${by('update')} updated` : '', by('add') ? `${by('add')} new` : '', by('remove') ? `${by('remove')} removed` : '',
        ...merges.map(target => `${target} merged`)
    ].filter(Boolean);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
};

export const conflictText = (conflicts: readonly CursorSyncConflict[]): string =>
    conflicts.length ? `${count(conflicts.length, 'conflict', 'conflicts')}: ${conflicts.map(c => `${c.target} ${CURSOR_SYNC_CONFLICT_TEXT[c.reason]}`).join('; ')}.` : '';

export const parseSyncFile = (text: string | undefined): CursorSyncFile => {
    try {
        const raw = JSON.parse(text ?? '') as Partial<CursorSyncFile>;
        return { version: CURSOR_SYNC_FILE_VERSION, workspaces: raw.workspaces && typeof raw.workspaces === 'object' ? raw.workspaces : {} };
    } catch {
        return { version: CURSOR_SYNC_FILE_VERSION, workspaces: {} };
    }
};

export const syncFileText = (file: CursorSyncFile, root: string, manifest: CursorSyncManifest): string => {
    const workspaces = { ...file.workspaces, [root]: manifest };
    if (!Object.keys(manifest).length) {
        delete workspaces[root];
    }
    return `${JSON.stringify({ version: CURSOR_SYNC_FILE_VERSION, workspaces }, undefined, 2)}\n`;
};
