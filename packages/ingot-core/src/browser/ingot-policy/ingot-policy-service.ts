import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    effectivePolicy, ENV_FILE_PATTERN, INGOT_DIR, parsePolicy, POLICY_FILE_NAME, POLICY_TEMPLATE, policyDirOf, policyDirsFor, policyFileFor,
    redactionLiterals, redactionPatterns, redactText
} from '../../common/ingot-kit';
import type { EffectivePolicy, PolicyLayer } from '../../common/ingot-kit';
import type { CachedLayer, PolicyScan, Redactor } from './ingot-policy.types';
import { POLICY_REFRESH_DEBOUNCE_MS, POLICY_SCAN_DEPTH, POLICY_SCAN_SKIP } from './ingot-policy.consts';

/**
 * IDEA-325 / IDEA-326: `.ingot/policy.yaml` files of the open project. A path's policy is every file from the root down
 * to its folder (nearest wins for model, budget and auto-approve; deny and redact lists add up). Files are cached and
 * re-read when they change.
 */
@injectable()
export class IngotPolicyService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly cache = new Map<string, Promise<CachedLayer>>();
    protected readonly envCache = new Map<string, Promise<{ path: string; text: string }[]>>();
    protected scanCache?: { root: string; result: Promise<PolicyScan> };
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected timer?: ReturnType<typeof setTimeout>;

    @postConstruct()
    protected init(): void {
        this.files.onDidFilesChange(event => {
            const touched = event.changes.some(change => change.resource.path.base === POLICY_FILE_NAME || ENV_FILE_PATTERN.test(change.resource.path.base));
            if (touched) {
                this.invalidate();
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.onDidChangeEmitter.fire(), POLICY_REFRESH_DEBOUNCE_MS);
            }
        });
        this.workspace.onWorkspaceChanged(() => {
            this.invalidate();
            this.onDidChangeEmitter.fire();
        });
    }

    protected invalidate(): void {
        this.cache.clear();
        this.envCache.clear();
        this.scanCache = undefined;
    }

    root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Project-relative path of a URI under the root, or undefined. */
    relative(uri: URI, root = this.root()): string | undefined {
        return root?.isEqualOrParent(uri) ? root.relative(uri)?.toString() ?? '' : undefined;
    }

    protected async read(uri: URI): Promise<string | undefined> {
        try {
            return (await this.files.read(uri)).value;
        } catch {
            return undefined;
        }
    }

    protected loadDir(root: URI, dir: string): Promise<CachedLayer> {
        const key = `${root.toString()}::${dir}`;
        let found = this.cache.get(key);
        if (!found) {
            const file = policyFileFor(dir);
            found = this.read(root.resolve(file)).then(text => {
                if (text === undefined) {
                    return { errors: [] };
                }
                const { policy, errors } = parsePolicy(text);
                return { layer: { dir, file, policy }, errors };
            });
            this.cache.set(key, found);
        }
        return found;
    }

    /** The policy files that apply to a project path (root first). */
    async layersFor(path: string, isDir = false, root = this.root()): Promise<PolicyLayer[]> {
        if (!root) {
            return [];
        }
        const loaded = await Promise.all(policyDirsFor(path, isDir).map(dir => this.loadDir(root, dir)));
        return loaded.map(entry => entry.layer).filter((layer): layer is PolicyLayer => !!layer);
    }

    async effective(path = '', isDir = false, root = this.root()): Promise<EffectivePolicy> {
        return effectivePolicy(await this.layersFor(path, isDir, root), path);
    }

    /** `.env*` files at the project root and in every policy folder, for value redaction. */
    protected async envFiles(root: URI, policy: EffectivePolicy): Promise<{ path: string; text: string }[]> {
        if (!policy.redactEnvFiles && !policy.redactEnvVars.length) {
            return [];
        }
        const dirs = [...new Set(['', ...policy.layers.map(policyDirOf)])];
        const lists = await Promise.all(dirs.map(dir => {
            const key = `${root.toString()}::${dir}`;
            let found = this.envCache.get(key);
            if (!found) {
                found = this.files.resolve(dir ? root.resolve(dir) : root).then(async stat => {
                    const names = (stat.children ?? []).filter(child => child.isFile && ENV_FILE_PATTERN.test(child.name)).map(child => child.name);
                    const read = await Promise.all(names.map(async name => ({ path: dir ? `${dir}/${name}` : name, text: await this.read(child(root, dir, name)) ?? '' })));
                    return read;
                }, () => []);
                this.envCache.set(key, found);
            }
            return found;
        }));
        return lists.flat();
    }

    async redactor(policy: EffectivePolicy, root = this.root()): Promise<Redactor> {
        const patterns = redactionPatterns(policy);
        const literals = root ? redactionLiterals(policy, await this.envFiles(root, policy)) : [];
        return text => redactText(text, patterns, literals);
    }

    /** Every policy file in the project (shallow scan, skipping dependencies), with its parse errors. */
    scan(root = this.root()): Promise<PolicyScan> {
        if (!root) {
            return Promise.resolve({ layers: [], errors: [] });
        }
        if (this.scanCache?.root !== root.toString()) {
            this.scanCache = { root: root.toString(), result: this.walk(root) };
        }
        return this.scanCache.result;
    }

    protected async walk(root: URI): Promise<PolicyScan> {
        const dirs: string[] = [];
        const walk = async (dir: string, depth: number): Promise<void> => {
            const stat = await this.files.resolve(dir ? root.resolve(dir) : root).catch(() => undefined);
            const children = stat?.children ?? [];
            if (children.some(c => c.isDirectory && c.name === INGOT_DIR)) {
                dirs.push(dir);
            }
            if (depth >= POLICY_SCAN_DEPTH) {
                return;
            }
            await Promise.all(children.filter(c => c.isDirectory && !c.name.startsWith('.') && !POLICY_SCAN_SKIP.includes(c.name))
                .map(c => walk(dir ? `${dir}/${c.name}` : c.name, depth + 1)));
        };
        await walk('', 0);
        const loaded = await Promise.all(dirs.sort().map(dir => this.loadDir(root, dir)));
        return {
            layers: loaded.map(entry => entry.layer).filter((layer): layer is PolicyLayer => !!layer),
            errors: loaded.filter(entry => entry.layer && entry.errors.length).map(entry => ({ file: entry.layer?.file ?? '', errors: entry.errors }))
        };
    }

    /** Writes the commented template into `<dir>/.ingot/policy.yaml` unless one exists; returns its URI. */
    async createTemplate(dir = '', root = this.root()): Promise<{ uri: URI; created: boolean } | undefined> {
        if (!root) {
            return undefined;
        }
        const uri = root.resolve(policyFileFor(dir));
        if (await this.files.exists(uri)) {
            return { uri, created: false };
        }
        await this.files.writeFile(uri, BinaryBuffer.fromString(POLICY_TEMPLATE));
        this.invalidate();
        this.onDidChangeEmitter.fire();
        return { uri, created: true };
    }
}

const child = (root: URI, dir: string, name: string): URI => (dir ? root.resolve(dir) : root).resolve(name);
