import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TestService, type ExplorerFile, type TestDiscovery, type TestResult, type TestRunRequest, type TestRunResult } from '../../common/testing/testing.types';
import { explorerFiles, failedRequest, runError } from '../../common/testing/testing.utils';
import { NO_RUNNER_TEXT } from '../../common/testing/testing.consts';

/**
 * IDEA-261: tests of the open folder and their latest results. The Test Explorer and the agent's run_tests tool
 * share it, so an agent run shows up in the explorer.
 */
@injectable()
export class TestStore {

    @inject(TestService) protected readonly service: TestService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    discovery?: TestDiscovery;
    loading = false;
    lastRun?: TestRunResult;
    /** Test ids of the run in progress; empty when idle. */
    running = new Set<string>();
    protected busy = false;
    protected readonly results = new Map<string, TestResult>();

    @postConstruct()
    protected init(): void {
        this.workspace.onWorkspaceChanged(() => {
            this.results.clear();
            this.lastRun = undefined;
            this.discovery = undefined;
            void this.refresh();
        });
    }

    get root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    get isRunning(): boolean {
        return this.busy;
    }

    get files(): ExplorerFile[] {
        return explorerFiles(this.discovery?.files ?? [], this.results);
    }

    get failed(): TestResult[] {
        return [...this.results.values()].filter(result => result.state === 'failed');
    }

    get allResults(): TestResult[] {
        return [...this.results.values()];
    }

    async refresh(): Promise<void> {
        const root = this.root;
        if (!root) {
            this.discovery = undefined;
            this.changed();
            return;
        }
        this.loading = true;
        this.changed();
        try {
            this.discovery = await this.service.discover(root);
        } finally {
            this.loading = false;
            this.changed();
        }
    }

    async ensureLoaded(): Promise<void> {
        if (!this.discovery && !this.loading) {
            await this.refresh();
        }
    }

    runAll(): Promise<TestRunResult> {
        return this.run({});
    }

    rerunFailed(): Promise<TestRunResult> | undefined {
        const request = failedRequest(this.failed);
        return request ? this.run(request) : undefined;
    }

    async run(request: TestRunRequest): Promise<TestRunResult> {
        const root = this.root;
        if (!root) {
            return runError(undefined, NO_RUNNER_TEXT);
        }
        await this.ensureLoaded();
        this.busy = true;
        this.running = new Set(this.targets(request));
        this.changed();
        try {
            const result = await this.service.run(root, request);
            if (!request.files?.length && !request.titles?.length && result.status !== 'error') {
                this.results.clear();
            }
            for (const test of result.tests) {
                this.results.set(test.id, test);
            }
            this.lastRun = result;
            return result;
        } finally {
            this.busy = false;
            this.running = new Set();
            this.changed();
        }
    }

    /** Ids the request will run, so their rows can spin. */
    protected targets(request: TestRunRequest): string[] {
        const files = new Set(request.files ?? []);
        const titles = new Set(request.titles ?? []);
        return (this.discovery?.files ?? [])
            .filter(file => !files.size || files.has(file.path))
            .flatMap(file => file.tests)
            .filter(test => !titles.size || titles.has(test.title))
            .map(test => test.id);
    }

    protected changed(): void {
        this.onDidChangeEmitter.fire();
    }
}
