import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type {
    CodebaseIndexClient, CodebaseIndexService, EmbeddingSettings, IndexStatus, SearchOptions, SearchResult
} from '../../common/codebase-index/codebase-index.types';
import { createEmbeddingProvider } from './embedding-providers';
import { WorkspaceIndex } from './workspace-index';

/** IDEA-260: one index per open project folder, shared by every window that has it open. */
@injectable()
export class IngotCodebaseIndexService implements CodebaseIndexService {

    protected readonly clients = new Set<CodebaseIndexClient>();
    protected readonly indexes = new Map<string, WorkspaceIndex>();

    setClient(client: CodebaseIndexClient | undefined): void {
        if (client) {
            this.clients.add(client);
        }
    }

    removeClient(client: CodebaseIndexClient): void {
        this.clients.delete(client);
    }

    dispose(): void {
        this.indexes.forEach(index => index.dispose());
        this.indexes.clear();
    }

    async open(root: string, settings: EmbeddingSettings): Promise<IndexStatus> {
        const key = path.resolve(root);
        const stat = await fs.promises.stat(key).catch(() => undefined);
        if (!stat?.isDirectory()) {
            throw new Error(`"${root}" is not a folder.`);
        }
        const provider = createEmbeddingProvider(settings);
        const known = this.indexes.get(key);
        if (known?.provider.key === provider.key) {
            return known.status();
        }
        known?.dispose();
        const index = new WorkspaceIndex(key, provider, status => this.notify(status));
        this.indexes.set(key, index);
        await index.load();
        void index.sync();
        index.watch();
        return index.status();
    }

    async close(root: string): Promise<void> {
        const key = path.resolve(root);
        this.indexes.get(key)?.dispose();
        this.indexes.delete(key);
    }

    async status(root: string): Promise<IndexStatus | undefined> {
        return this.indexes.get(path.resolve(root))?.status();
    }

    async rebuild(root: string): Promise<IndexStatus> {
        const index = this.require(root);
        void index.sync(true);
        return index.status();
    }

    async search(root: string, query: string, options?: SearchOptions): Promise<SearchResult> {
        return this.require(root).search(query, options);
    }

    protected require(root: string): WorkspaceIndex {
        const index = this.indexes.get(path.resolve(root));
        if (!index) {
            throw new Error('The codebase index is not open for this folder.');
        }
        return index;
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
