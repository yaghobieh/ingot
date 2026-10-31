import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { emptyLock, isEnforcedPath, LOCK_FILE } from '../../common/ingot-kit';
import type { LockIssue, PackLock } from '../../common/ingot-kit';
import { RulePacksService, type RulePackResult } from '../../common/rule-packs/rule-packs.types';

/** IDEA-322: the open project's lockfile, shared by the Rule Packs view, the commands and the read-only editors. */
@injectable()
export class RulePacksModel {

    @inject(RulePacksService) readonly service: RulePacksService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;

    lock: PackLock = emptyLock();
    issues: readonly LockIssue[] = [];
    busy = false;
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.workspace.onWorkspaceChanged(() => this.reload());
        this.files.onDidFilesChange(event => {
            if (event.changes.some(change => change.resource.path.toString().endsWith(LOCK_FILE))) {
                this.reload();
            }
        });
        this.reload();
    }

    rootUri(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    root(): string | undefined {
        return this.rootUri()?.path.fsPath();
    }

    async reload(): Promise<void> {
        const root = this.root();
        this.lock = root ? await this.service.lock(root).catch(() => emptyLock()) : emptyLock();
        this.onDidChangeEmitter.fire();
    }

    isEnforced(uri: URI): boolean {
        const root = this.rootUri();
        const rel = root?.relative(uri)?.toString();
        return !!rel && isEnforcedPath(this.lock, rel);
    }

    /** Runs one service call with the busy flag; the result's lock becomes the model's. */
    async run(work: (root: string) => Promise<RulePackResult>): Promise<RulePackResult | undefined> {
        const root = this.root();
        if (!root) {
            return undefined;
        }
        this.busy = true;
        this.onDidChangeEmitter.fire();
        try {
            const result = await work(root);
            this.lock = result.lock;
            this.issues = [];
            return result;
        } finally {
            this.busy = false;
            this.onDidChangeEmitter.fire();
        }
    }

    async verify(): Promise<readonly LockIssue[]> {
        const root = this.root();
        this.issues = root ? await this.service.verify(root) : [];
        this.onDidChangeEmitter.fire();
        return this.issues;
    }
}
