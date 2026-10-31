import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    createSpecFiles, findTask, SPEC_DOCS, specDir, specDocPath, specSlug, SPECS_DIR, setTaskDone, summarizeSpec
} from '../../common/ingot-kit';
import type { SpecDoc, SpecSummary } from '../../common/ingot-kit';
import type { AgentActionResult } from '../../common/agents/agent-actions-service';
import { SPECS_REFRESH_DEBOUNCE_MS } from './specs.consts';

/** IDEA-324: reads and writes `.ingot/specs/<feature>/{requirements,design,tasks}.md` of the open project. */
@injectable()
export class SpecsService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected timer?: ReturnType<typeof setTimeout>;

    @postConstruct()
    protected init(): void {
        this.files.onDidFilesChange(event => {
            const root = this.root();
            if (root && event.changes.some(change => root.resolve(SPECS_DIR).isEqualOrParent(change.resource))) {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.onDidChangeEmitter.fire(), SPECS_REFRESH_DEBOUNCE_MS);
            }
        });
        this.workspace.onWorkspaceChanged(() => this.onDidChangeEmitter.fire());
    }

    root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    protected async read(uri: URI): Promise<string | undefined> {
        try {
            return (await this.files.read(uri)).value;
        } catch {
            return undefined;
        }
    }

    protected async write(uri: URI, text: string): Promise<void> {
        await this.files.writeFile(uri, BinaryBuffer.fromString(text));
    }

    async get(slug: string, root = this.root()): Promise<SpecSummary | undefined> {
        if (!root || !await this.files.exists(root.resolve(specDir(slug)))) {
            return undefined;
        }
        const docs: Partial<Record<SpecDoc, string>> = {};
        for (const doc of SPEC_DOCS) {
            const text = await this.read(root.resolve(specDocPath(slug, doc)));
            if (text !== undefined) {
                docs[doc] = text;
            }
        }
        return summarizeSpec(slug, docs);
    }

    async list(root = this.root()): Promise<SpecSummary[]> {
        if (!root) {
            return [];
        }
        const dir = root.resolve(SPECS_DIR);
        const stat = await this.files.resolve(dir).catch(() => undefined);
        const slugs = (stat?.children ?? []).filter(child => child.isDirectory).map(child => child.name);
        const specs = await Promise.all(slugs.map(slug => this.get(slug, root)));
        return specs.filter((spec): spec is SpecSummary => !!spec).sort((a, b) => a.slug.localeCompare(b.slug));
    }

    /** Writes the three templates; undefined when a spec with that name exists. */
    async create(name: string, summary = '', root = this.root()): Promise<SpecSummary | undefined> {
        if (!root) {
            return undefined;
        }
        const { slug, files } = createSpecFiles(name, summary);
        if (await this.files.exists(root.resolve(specDir(slug)))) {
            return undefined;
        }
        for (const file of files) {
            await this.write(root.resolve(file.path), file.content);
        }
        this.onDidChangeEmitter.fire();
        return this.get(slug, root);
    }

    docUri(slug: string, doc: SpecDoc, root = this.root()): URI | undefined {
        return root?.resolve(specDocPath(slug, doc));
    }

    /** Ticks a task on or off (parents follow their sub-tasks). */
    async setDone(slug: string, id: string, done: boolean, root = this.root()): Promise<SpecSummary | undefined> {
        const uri = root?.resolve(specDocPath(slug, 'tasks'));
        const text = uri && await this.read(uri);
        if (!uri || text === undefined) {
            return undefined;
        }
        await this.write(uri, setTaskDone(text, id, done));
        this.onDidChangeEmitter.fire();
        return this.get(slug, root);
    }

    /** The agent's `ingot/spec_task` tool. */
    async toolCall(root: URI, args: Record<string, unknown>): Promise<AgentActionResult> {
        const slug = specSlug(typeof args.spec === 'string' ? args.spec : '');
        const id = typeof args.task === 'string' || typeof args.task === 'number' ? String(args.task) : '';
        const spec = slug ? await this.get(slug, root) : undefined;
        if (!spec) {
            return { text: `No spec "${String(args.spec ?? '')}" in ${SPECS_DIR}.`, isError: true };
        }
        const task = findTask(spec.tasks, id);
        if (!task) {
            return { text: `No task "${id}" in ${specDocPath(slug, 'tasks')}. Tasks: ${spec.tasks.map(t => t.id).join(', ')}.`, isError: true };
        }
        const next = await this.setDone(slug, task.id, args.done !== false, root);
        const progress = next?.progress ?? spec.progress;
        return { text: `${args.done !== false ? 'Checked off' : 'Reopened'} task ${task.id} (${task.title}) in ${specDocPath(slug, 'tasks')}: ${progress.done}/${progress.total} done.`, isError: false };
    }
}
