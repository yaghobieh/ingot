import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_OLLAMA_EMBED_MODEL, EMBEDDING_PROVIDERS, INDEX_PREFS } from '../../common/codebase-index/codebase-index.consts';
import {
    CodebaseIndexService, type CodebaseIndexClient, type EmbeddingProviderId, type EmbeddingSettings, type IndexStatus, type SearchOptions, type SearchResult
} from '../../common/codebase-index/codebase-index.types';
import { MODEL_PREFERENCES } from '../../common/models/models.consts';

/** IDEA-260: index status pushed by the backend. */
@injectable()
export class CodebaseIndexClientImpl implements CodebaseIndexClient {
    protected readonly onChangedEmitter = new Emitter<IndexStatus>();
    readonly onChanged: Event<IndexStatus> = this.onChangedEmitter.event;

    onStatusChanged(status: IndexStatus): void {
        this.onChangedEmitter.fire(status);
    }
}

/** Opens the index for each workspace root, follows the settings and keeps the latest status per root. */
@injectable()
export class CodebaseIndexStore {

    @inject(CodebaseIndexService) protected readonly service: CodebaseIndexService;
    @inject(CodebaseIndexClientImpl) protected readonly client: CodebaseIndexClientImpl;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected readonly statuses = new Map<string, IndexStatus>();
    protected opened = new Set<string>();

    async start(): Promise<void> {
        this.client.onChanged(status => this.set(status));
        this.workspace.onWorkspaceChanged(() => void this.openRoots());
        this.preferences.onPreferenceChanged(e => {
            if (Object.values(INDEX_PREFS).includes(e.preferenceName as typeof INDEX_PREFS[keyof typeof INDEX_PREFS]) || e.preferenceName === MODEL_PREFERENCES.ollamaUrl) {
                void this.openRoots();
            }
        });
        await Promise.all([this.workspace.ready, this.preferences.ready]);
        await this.openRoots();
    }

    get enabled(): boolean {
        return this.preferences.get<boolean>(INDEX_PREFS.enabled, true) !== false;
    }

    /** Status of the first root (what the status bar shows). */
    get primary(): IndexStatus | undefined {
        const root = this.roots()[0];
        return root ? this.statuses.get(root) : undefined;
    }

    async rebuild(): Promise<void> {
        await Promise.all(this.roots().filter(root => this.opened.has(root)).map(root => this.service.rebuild(root).then(status => this.set(status), () => undefined)));
    }

    async search(root: string, query: string, options?: SearchOptions): Promise<SearchResult> {
        if (!this.opened.has(root)) {
            await this.open(root);
        }
        return this.service.search(root, query, options);
    }

    protected roots(): string[] {
        return this.workspace.tryGetRoots().map(root => root.resource.path.fsPath()).filter(Boolean);
    }

    protected settings(): EmbeddingSettings {
        const raw = this.preferences.get<string>(INDEX_PREFS.provider, DEFAULT_EMBEDDING_PROVIDER);
        const provider: EmbeddingProviderId = (EMBEDDING_PROVIDERS as readonly string[]).includes(raw) ? raw as EmbeddingProviderId : DEFAULT_EMBEDDING_PROVIDER;
        return {
            provider,
            ollamaBaseUrl: this.preferences.get<string>(MODEL_PREFERENCES.ollamaUrl),
            ollamaModel: this.preferences.get<string>(INDEX_PREFS.ollamaModel, DEFAULT_OLLAMA_EMBED_MODEL)
        };
    }

    protected async openRoots(): Promise<void> {
        const roots = this.roots();
        for (const root of [...this.opened].filter(root => !roots.includes(root) || !this.enabled)) {
            this.opened.delete(root);
            this.statuses.delete(root);
            await this.service.close(root).catch(() => undefined);
        }
        if (this.enabled) {
            await Promise.all(roots.map(root => this.open(root)));
        }
        this.onDidChangeEmitter.fire();
    }

    protected async open(root: string): Promise<void> {
        const status = await this.service.open(root, this.settings()).catch(() => undefined);
        if (status) {
            this.opened.add(root);
            this.set(status);
        }
    }

    protected set(status: IndexStatus): void {
        if (!this.roots().includes(status.root)) {
            return;
        }
        this.statuses.set(status.root, status);
        this.onDidChangeEmitter.fire();
    }
}
