import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type {
    CodebaseIndexClient, CodebaseIndexService, EmbeddingSettings, IndexStatus, SearchOptions, SearchResult
} from '../../common/codebase-index/codebase-index.types';
import { createEmbeddingProvider } from './embedding-providers';
import { WorkspaceIndex } from './workspace-index';

interface OpenIndex {
    index: WorkspaceIndex;
    refs: number;
}

/**
 * IDEA-260: one index per open project folder, shared by every window that has it open and disposed when the last
 * one closes it (see {@link CodebaseIndexConnection}).
 */
@injectable()
export class IngotCodebaseIndexService implements CodebaseIndexService {

    protected readonly clients = new Set<CodebaseIndexClient>();
    protected readonly indexes = new Map<string, OpenIndex>();

    setClient(client: CodebaseIndexClient | undefined): void {
        if (client) {
            this.clients.add(client);
        }
    }

    removeClient(client: CodebaseIndexClient): void {
        this.clients.delete(client);
    }

    dispose(): void {
        this.indexes.forEach(open => open.index.dispose());
        this.indexes.clear();
    }

    /**
     * Each call with `acquire` is balanced by one {@link close}; without it only the settings are applied (another
     * embedding provider rebuilds the index).
     */
    async open(root: string, settings: EmbeddingSettings, acquire = true): Promise<IndexStatus> {
        const key = path.resolve(root);
        const stat = await fs.promises.stat(key).catch(() => undefined);
        if (!stat?.isDirectory()) {
            throw new Error(`"${root}" is not a folder.`);
        }
        const provider = createEmbeddingProvider(settings);
        const known = this.indexes.get(key);
        const refs = (known?.refs ?? 0) + (acquire || !known ? 1 : 0);
        if (known?.index.provider.key === provider.key) {
            known.refs = refs;
            return known.index.status();
        }
        known?.index.dispose();
        const index = new WorkspaceIndex(key, provider, status => this.notify(status));
        this.indexes.set(key, { index, refs });
        await index.load();
        void index.sync();
        return index.status();
    }

    async close(root: string): Promise<void> {
        const key = path.resolve(root);
        const open = this.indexes.get(key);
        if (open && --open.refs <= 0) {
            open.index.dispose();
            this.indexes.delete(key);
        }
    }

    async changed(root: string, paths: readonly string[]): Promise<void> {
        this.indexes.get(path.resolve(root))?.index.notifyChanged(paths);
    }

    async status(root: string): Promise<IndexStatus | undefined> {
        return this.indexes.get(path.resolve(root))?.index.status();
    }

    async rebuild(root: string): Promise<IndexStatus> {
        const index = this.require(root);
        void index.sync(true);
        return index.status();
    }

    async search(root: string, query: string, options?: SearchOptions): Promise<SearchResult> {
        return this.require(root).search(query, options);
    }

    isOpen(root: string): boolean {
        return this.indexes.has(path.resolve(root));
    }

    protected require(root: string): WorkspaceIndex {
        const open = this.indexes.get(path.resolve(root));
        if (!open) {
            throw new Error('The codebase index is not open for this folder.');
        }
        return open.index;
    }

    protected notify(status: IndexStatus): void {
        for (const client of this.clients) {
            try {
                client.onStatusChanged(status);
            } catch {
                // A closed window; it is removed when its connection ends.
            }
        }
    }
}

/** One window's view of the shared service: remembers what it opened so a closed window releases its indexes. */
export class CodebaseIndexConnection implements CodebaseIndexService {

    protected readonly roots = new Set<string>();

    constructor(protected readonly service: IngotCodebaseIndexService) { }

    setClient(client: CodebaseIndexClient | undefined): void {
        this.service.setClient(client);
    }

    removeClient(client: CodebaseIndexClient): void {
        this.service.removeClient(client);
    }

    dispose(): void {
        this.roots.forEach(root => void this.service.close(root));
        this.roots.clear();
    }

    async open(root: string, settings: EmbeddingSettings): Promise<IndexStatus> {
        const key = path.resolve(root);
        const status = await this.service.open(key, settings, !this.roots.has(key));
        this.roots.add(key);
        return status;
    }

    async close(root: string): Promise<void> {
        const key = path.resolve(root);
        if (this.roots.delete(key)) {
            await this.service.close(key);
        }
    }

    changed(root: string, paths: readonly string[]): Promise<void> {
        return this.service.changed(root, paths);
    }

    status(root: string): Promise<IndexStatus | undefined> {
        return this.service.status(root);
    }

    rebuild(root: string): Promise<IndexStatus> {
        return this.service.rebuild(root);
    }

    search(root: string, query: string, options?: SearchOptions): Promise<SearchResult> {
        return this.service.search(root, query, options);
    }
}
