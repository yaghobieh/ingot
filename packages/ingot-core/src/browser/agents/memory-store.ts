import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ProjectConfigService } from '../project-config/project-config-service';
import {
    GENERATE_MEMORIES_KEY, LEGACY_MEMORIES_DIR, MEMORIES_DIR, MEMORIES_GITIGNORE, isMemoryId, newMemoryId, parseMemory, serializeMemory,
    type Memory, type MemoryKind, type MemoryScope
} from '../../common/memories/memories';

const INGOT_DIR = '.ingot';

export interface MemoryChanges {
    readonly text: string;
    readonly scope?: MemoryScope;
    readonly kind?: MemoryKind;
}

/**
 * Agent memories (IDEA-77, IDEA-267): global in `~/.ingot/memory`, per project in `.ingot/memory` (git-ignored by default).
 * One Markdown file per memory, so they are easy to read, edit or share.
 */
@injectable()
export class MemoryStore {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected cache: Memory[] = [];

    get memories(): readonly Memory[] {
        return this.cache;
    }

    get generate(): boolean {
        return localStorage.getItem(GENERATE_MEMORIES_KEY) !== 'false';
    }

    set generate(on: boolean) {
        localStorage.setItem(GENERATE_MEMORIES_KEY, String(on));
        this.onDidChangeEmitter.fire();
    }

    protected projectRoot(root?: URI): URI | undefined {
        return root ?? this.workspace.tryGetRoots()[0]?.resource;
    }

    protected async base(scope: MemoryScope, root?: URI): Promise<URI | undefined> {
        return scope === 'global' ? this.projectConfig.globalDir() : this.projectRoot(root)?.resolve(INGOT_DIR);
    }

    async dir(scope: MemoryScope, root?: URI): Promise<URI | undefined> {
        return (await this.base(scope, root))?.resolve(MEMORIES_DIR);
    }

    /** Moves an IDEA-77 `memories` folder to `memory` once, when the new folder does not exist yet. */
    protected async migrate(scope: MemoryScope, root?: URI): Promise<void> {
        const base = await this.base(scope, root);
        if (!base) {
            return;
        }
        const legacy = base.resolve(LEGACY_MEMORIES_DIR);
        const target = base.resolve(MEMORIES_DIR);
        if (await this.files.exists(legacy) && !(await this.files.exists(target))) {
            await this.files.move(legacy, target).catch(() => undefined);
        }
    }

    /** Reads project and global memories (newest first). */
    async load(root?: URI): Promise<readonly Memory[]> {
        const all: Memory[] = [];
        for (const scope of ['project', 'global'] as const) {
            await this.migrate(scope, root);
            const dir = await this.dir(scope, root);
            if (!dir || !(await this.files.exists(dir))) {
                continue;
            }
            const stat = await this.files.resolve(dir);
            for (const child of stat.children ?? []) {
                const name = child.resource.path.base;
                if (child.isDirectory || !name.endsWith('.md')) {
                    continue;
                }
                try {
                    const memory = parseMemory(name.slice(0, -3), scope, (await this.files.read(child.resource)).value);
                    if (memory) {
                        all.push(memory);
                    }
                } catch {
                    // unreadable: skip
                }
            }
        }
        this.cache = all.sort((a, b) => b.createdAt - a.createdAt);
        this.onDidChangeEmitter.fire();
        return this.cache;
    }

    async save(scope: MemoryScope, text: string, root?: URI, kind: MemoryKind = 'fact'): Promise<Memory | undefined> {
        const dir = await this.dir(scope, root);
        const clean = text.trim();
        if (!dir || !clean) {
            return undefined;
        }
        if (scope === 'project') {
            const ignore = dir.resolve('.gitignore');
            if (!(await this.files.exists(ignore))) {
                await this.files.create(ignore, MEMORIES_GITIGNORE, { overwrite: false }).catch(() => undefined);
            }
        }
        const memory: Memory = { id: newMemoryId(), scope, kind, text: clean, createdAt: Date.now() };
        await this.files.create(dir.resolve(`${memory.id}.md`), serializeMemory(memory), { overwrite: true });
        await this.load(root);
        return memory;
    }

    async update(memory: Memory, changes: MemoryChanges, root?: URI): Promise<void> {
        const scope = changes.scope ?? memory.scope;
        if (!isMemoryId(memory.id) || !changes.text.trim()) {
            return;
        }
        if (scope !== memory.scope) {
            await this.remove(memory, root);
        }
        const dir = await this.dir(scope, root);
        if (dir) {
            const next: Memory = { ...memory, scope, kind: changes.kind ?? memory.kind, text: changes.text.trim() };
            await this.files.create(dir.resolve(`${memory.id}.md`), serializeMemory(next), { overwrite: true });
        }
        await this.load(root);
    }

    async remove(memory: Pick<Memory, 'id' | 'scope'>, root?: URI): Promise<void> {
        const dir = await this.dir(memory.scope, root);
        if (dir && isMemoryId(memory.id)) {
            await this.files.delete(dir.resolve(`${memory.id}.md`)).catch(() => undefined);
        }
        await this.load(root);
    }
}
