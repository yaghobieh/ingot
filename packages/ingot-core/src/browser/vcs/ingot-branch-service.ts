import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { parseGitHead } from '../../common/vcs/vcs.utils';

const POLL_MS = 3_000;

/** Tracks the current Git branch of the first workspace root by reading `.git/HEAD`. */
@injectable()
export class IngotBranchService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly onDidChangeEmitter = new Emitter<string | undefined>();
    readonly onDidChange: Event<string | undefined> = this.onDidChangeEmitter.event;
    protected current?: string;

    get branch(): string | undefined {
        return this.current;
    }

    @postConstruct()
    protected init(): void {
        this.workspace.onWorkspaceChanged(() => this.refresh());
        this.refresh();
        setInterval(() => this.refresh(), POLL_MS);
    }

    async refresh(): Promise<void> {
        const [root] = this.workspace.tryGetRoots();
        let next: string | undefined;
        if (root) {
            try {
                const head = await this.files.read(root.resource.resolve('.git/HEAD'));
                next = parseGitHead(head.value);
            } catch {
                next = undefined;
            }
        }
        if (next !== this.current) {
            this.current = next;
            this.onDidChangeEmitter.fire(next);
        }
    }
}
