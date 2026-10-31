import { INSTALLABLE_PACK_TYPES, LATEST_RANGE, maxSatisfying, planPackFiles } from '../ingot-kit';
import type { PackManifest, PackSpec, PackVersionsResponse, PlannedFile } from '../ingot-kit';
import { PACK_MANIFEST_FILE } from './rule-packs.consts';

const isSafePath = (path: string): boolean => !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '..' || part === '');

/** The version a range installs (resolved here too, so a store bug cannot install something outside the range). */
export const pickPackVersion = (info: Pick<PackVersionsResponse, 'latest' | 'versions'>, range: string): string | undefined => {
    const versions = info.versions.map(entry => entry.version);
    return range === LATEST_RANGE ? info.latest || versions[0] : maxSatisfying(versions, range);
};

/**
 * Checks a downloaded archive (its text entries by path) against what was asked for and returns the files to write,
 * or the reason it cannot be installed.
 */
export const planArchive = (spec: PackSpec, version: string, entries: ReadonlyMap<string, string>): { manifest: PackManifest; files: PlannedFile[] } | { error: string } => {
    const raw = entries.get(PACK_MANIFEST_FILE);
    let manifest: PackManifest;
    try {
        manifest = JSON.parse(raw ?? '') as PackManifest;
    } catch {
        return { error: `${spec.key}@${version} has no valid ${PACK_MANIFEST_FILE}.` };
    }
    if (manifest.publisher !== spec.publisher || manifest.name !== spec.name || manifest.version !== version) {
        return { error: `The store sent ${manifest.publisher}.${manifest.name}@${manifest.version} for ${spec.key}@${version}.` };
    }
    if (!(INSTALLABLE_PACK_TYPES as readonly string[]).includes(manifest.type)) {
        return { error: `${spec.key} is a ${manifest.type} extension, not a rule pack. Install it from the Store view.` };
    }
    const paths = [...(manifest.contributes?.rules ?? []).map(r => r.path), ...(manifest.contributes?.commands ?? []).map(c => c.path)];
    const unsafe = paths.find(path => !isSafePath(path));
    if (unsafe !== undefined) {
        return { error: `${spec.key}@${version} points at an unsafe path (${unsafe}).` };
    }
    const missing = paths.find(path => !entries.has(path));
    if (missing) {
        return { error: `${spec.key}@${version} is missing ${missing}.` };
    }
    return { manifest, files: planPackFiles(manifest, entries) };
};
