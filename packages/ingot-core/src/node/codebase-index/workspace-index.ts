import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
    EMBED_BATCH_SIZE, FILE_TEXT_CACHE_SIZE, INDEX_DIR, INDEX_FORMAT_VERSION, INDEX_GITIGNORE_FILE, INDEX_GITIGNORE_TEXT, INDEX_MANIFEST_FILE, INDEX_VECTORS_FILE, INDEX_YIELD_EVERY,
    INDEXED_HIDDEN_DIR, MAX_AVG_LINE_CHARS, MAX_INDEX_FILE_BYTES, MAX_INDEX_FILES, ORPHAN_VECTORS_KEPT, QUERY_CACHE_SIZE, REINDEX_DEBOUNCE_MS, RESULT_CACHE_SIZE, SAVE_DEBOUNCE_MS,
    SEARCH_CANDIDATES, SEARCH_WAIT_MS, SECRET_FILE_RE, TARGETED_UPDATE_MAX
} from '../../common/codebase-index/codebase-index.consts';
import type { EmbeddingProvider, IndexState, IndexStatus, SearchHit, SearchOptions, SearchResult, TextChunk } from '../../common/codebase-index/codebase-index.types';
import { chunkText, clampLimit, dot, dropOverlaps, LruCache, rankCandidates, snippetWindow, underPath } from '../../common/codebase-index/codebase-index.utils';
import { compileGitignore, isTextCandidate, SKIPPED_DIRS } from '../../common/agents/workspace-tools';
import type { FileEntry, FileStat, IndexManifest, StoredChunk } from './workspace-index.types';

const HASH_CHARS = 16;
const GITIGNORE = '.gitignore';
const NUL = '\u0000';
const KEY_SEPARATOR = '\u0000';

const contentHash = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, HASH_CHARS);
const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
const statChanged = (entry: FileEntry | undefined, stat: FileStat): boolean => !entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size;
const underIndexDir = (rel: string): boolean => rel === INDEX_DIR || rel.startsWith(`${INDEX_DIR}/`);
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * The index of one project folder: content-addressed chunk vectors (an embedding is computed once per distinct chunk
 * text and reused across files, renames and rebuilds), persisted under `.ingot/index` and kept current by a watcher.
 */
export class WorkspaceIndex {
    protected readonly files = new Map<string, FileEntry>();
    protected readonly vectors = new Map<string, Float32Array>();
    protected readonly queryVectors = new LruCache<string, Float32Array>(QUERY_CACHE_SIZE);
    protected readonly results = new LruCache<string, SearchHit[]>(RESULT_CACHE_SIZE);
    protected readonly fileLines = new LruCache<string, string[]>(FILE_TEXT_CACHE_SIZE);
    protected state: IndexState = 'idle';
    protected done = 0;
    protected total = 0;
    protected embedded = 0;
    protected reused = 0;
    protected error?: string;
    protected updatedAt?: number;
    /** Bumped on every change, so cached results are never stale. */
    protected generation = 0;
    protected queue: Promise<void> = Promise.resolve();
    protected ignored: (rel: string) => boolean = () => false;
    protected watcher?: fs.FSWatcher;
    protected readonly changed = new Set<string>();
    protected walkPending = false;
    protected changeTimer?: ReturnType<typeof setTimeout>;
    protected saveTimer?: ReturnType<typeof setTimeout>;
    protected disposed = false;

    constructor(
        readonly root: string,
        readonly provider: EmbeddingProvider,
        protected readonly onStatus: (status: IndexStatus) => void = () => undefined
    ) { }

    protected get indexDir(): string {
        return path.join(this.root, ...INDEX_DIR.split('/'));
    }

    status(): IndexStatus {
        let chunks = 0;
        for (const entry of this.files.values()) {
            chunks += entry.chunks.length;
        }
        return {
            root: this.root, state: this.state, files: this.files.size, chunks, done: this.done, total: this.total, embedded: this.embedded, reused: this.reused,
            provider: this.provider.label, ...(this.updatedAt ? { updatedAt: this.updatedAt } : {}), ...(this.error ? { error: this.error } : {})
        };
    }

    /** Reads `.ingot/index` when it was written with the same format and embedding provider. */
    async load(): Promise<void> {
        try {
            const manifest = JSON.parse(await fs.promises.readFile(path.join(this.indexDir, INDEX_MANIFEST_FILE), 'utf8')) as IndexManifest;
            if (manifest.version !== INDEX_FORMAT_VERSION || manifest.provider !== this.provider.key) {
                return;
            }
            const bytes = await fs.promises.readFile(path.join(this.indexDir, INDEX_VECTORS_FILE));
            const floats = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
            if (floats.length !== manifest.vectors.length * manifest.dims) {
                return;
            }
            manifest.vectors.forEach((hash, i) => this.vectors.set(hash, floats.slice(i * manifest.dims, (i + 1) * manifest.dims)));
            for (const [rel, entry] of Object.entries(manifest.files)) {
                this.files.set(rel, entry);
            }
            this.state = this.files.size ? 'ready' : 'idle';
        } catch {
            // No index yet (or an unreadable one): the next sync builds it.
        }
    }

    /** Brings the index up to date with the folder. `force` re-chunks every file (embeddings still come from the cache). */
    sync(force = false): Promise<void> {
        return this.enqueue(() => this.runSync(force));
    }

    /** Re-indexes only these project-relative paths (files or deleted folders). */
    update(rels: readonly string[]): Promise<void> {
        return this.enqueue(() => this.runUpdate(rels));
    }

    watch(): void {
        try {
            this.watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => this.onFsChange(filename ? String(filename).split(path.sep).join('/') : undefined));
            this.watcher.on('error', () => this.unwatch());
        } catch {
            // Recursive watching is not available here: the index still updates on Rebuild.
        }
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
        const text = query.trim();
        await this.settle(SEARCH_WAIT_MS);
        if (!text) {
            return { query: text, hits: [], status: this.status(), cached: false };
        }
        if (this.state === 'error' && !this.files.size) {
            return { query: text, hits: [], status: this.status(), cached: false, error: this.error };
        }
        const limit = clampLimit(options.limit);
        const key = [this.generation, limit, options.path ?? '', text].join(KEY_SEPARATOR);
        const cached = this.results.get(key);
        if (cached) {
            return { query: text, hits: cached, status: this.status(), cached: true };
        }
        let queryVector = this.queryVectors.get(text);
        if (!queryVector) {
            try {
                [queryVector] = await this.provider.embed([text]);
            } catch (error) {
                return { query: text, hits: [], status: this.status(), cached: false, error: errorText(error) };
            }
            this.queryVectors.set(text, queryVector);
        }
        const scored: { path: string; chunk: StoredChunk; cosine: number }[] = [];
        for (const [rel, entry] of this.files) {
            if (!underPath(rel, options.path)) {
                continue;
            }
            for (const chunk of entry.chunks) {
                const vector = this.vectors.get(chunk.hash);
                if (vector) {
                    scored.push({ path: rel, chunk, cosine: dot(queryVector, vector) });
                }
            }
        }
        scored.sort((a, b) => b.cosine - a.cosine);
        const candidates: (TextChunk & { path: string; cosine: number })[] = [];
        for (const item of scored.slice(0, SEARCH_CANDIDATES)) {
            const lines = await this.linesOf(item.path);
            if (lines) {
                candidates.push({ path: item.path, cosine: item.cosine, startLine: item.chunk.start, endLine: item.chunk.end, text: lines.slice(item.chunk.start - 1, item.chunk.end).join('\n') });
            }
        }
        const hits = dropOverlaps(rankCandidates(text, candidates, candidates.length)).slice(0, limit).map(hit => {
            const window = snippetWindow(hit, text);
            return { path: hit.path, startLine: window.startLine, endLine: window.endLine, score: hit.score, snippet: window.text };
        });
        this.results.set(key, hits);
        return { query: text, hits, status: this.status(), cached: false };
    }

    dispose(): void {
        this.disposed = true;
        this.unwatch();
        clearTimeout(this.changeTimer);
        clearTimeout(this.saveTimer);
    }

    /** Waits for queued work, at most `ms`; a search on a half-built index beats a long wait. */
    protected async settle(ms: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([this.queue, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]);
        clearTimeout(timer);
    }

    protected enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.queue.then(() => this.disposed ? undefined : task()).catch(error => this.fail(error));
        this.queue = run;
        return run;
    }

    protected fail(error: unknown): void {
        this.state = 'error';
        this.error = errorText(error);
        this.emit();
    }

    protected emit(): void {
        if (!this.disposed) {
            this.onStatus(this.status());
        }
    }

    protected unwatch(): void {
        this.watcher?.close();
        this.watcher = undefined;
    }

    protected onFsChange(rel: string | undefined): void {
        if (rel === undefined) {
            this.walkPending = true;
        } else if (this.watchable(rel)) {
            this.changed.add(rel);
        } else {
            return;
        }
        clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => this.flushChanges(), REINDEX_DEBOUNCE_MS);
    }

    protected flushChanges(): void {
        const rels = [...this.changed];
        this.changed.clear();
        const walk = this.walkPending || rels.length > TARGETED_UPDATE_MAX || rels.includes(GITIGNORE);
        this.walkPending = false;
        void (walk ? this.sync() : this.update(rels));
    }

    protected watchable(rel: string): boolean {
        if (rel === GITIGNORE) {
            return true;
        }
        if (underIndexDir(rel) || this.ignored(rel)) {
            return false;
        }
        return !rel.split('/').some(part => SKIPPED_DIRS.has(part) || (part.startsWith('.') && part !== INDEXED_HIDDEN_DIR));
    }

    protected skipsDir(name: string, rel: string): boolean {
        return SKIPPED_DIRS.has(name) || (name.startsWith('.') && name !== INDEXED_HIDDEN_DIR) || underIndexDir(rel) || this.ignored(rel);
    }

    protected indexable(rel: string): boolean {
        const name = rel.split('/').pop() ?? rel;
        return !name.startsWith('.') && !SECRET_FILE_RE.test(name) && isTextCandidate(rel) && !this.ignored(rel);
    }

    protected async runSync(force: boolean): Promise<void> {
        const gitignore = await fs.promises.readFile(path.join(this.root, GITIGNORE), 'utf8').catch(() => undefined);
        this.ignored = compileGitignore(gitignore);
        const found = await this.walk();
        let removed = false;
        for (const rel of [...this.files.keys()]) {
            if (!found.has(rel)) {
                this.files.delete(rel);
                removed = true;
            }
        }
        await this.indexFiles([...found].filter(([rel, stat]) => force || statChanged(this.files.get(rel), stat)), removed);
    }

    protected async runUpdate(rels: readonly string[]): Promise<void> {
        const todo: [string, FileStat][] = [];
        let removed = false;
        for (const rel of rels) {
            const stat = await fs.promises.stat(path.join(this.root, rel)).catch(() => undefined);
            if (!stat) {
                for (const key of [...this.files.keys()]) {
                    if (key === rel || key.startsWith(`${rel}/`)) {
                        removed = this.files.delete(key) || removed;
                    }
                }
                continue;
            }
            if (stat.isDirectory()) {
                return this.runSync(false);
            }
            if (!stat.isFile() || !this.indexable(rel) || stat.size > MAX_INDEX_FILE_BYTES) {
                removed = this.files.delete(rel) || removed;
                continue;
            }
            if (statChanged(this.files.get(rel), stat)) {
                todo.push([rel, { mtimeMs: stat.mtimeMs, size: stat.size }]);
            }
        }
        await this.indexFiles(todo, removed);
    }

    protected async walk(): Promise<Map<string, FileStat>> {
        const found = new Map<string, FileStat>();
        const visit = async (dir: string, relDir: string): Promise<void> => {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                if (found.size >= MAX_INDEX_FILES) {
                    return;
                }
                const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!this.skipsDir(entry.name, rel)) {
                        await visit(full, rel);
                    }
                } else if (entry.isFile() && this.indexable(rel)) {
                    const stat = await fs.promises.stat(full).catch(() => undefined);
                    if (stat && stat.size <= MAX_INDEX_FILE_BYTES) {
                        found.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size });
                    }
                }
            }
        };
        await visit(this.root, '');
        return found;
    }

    protected async indexFiles(todo: readonly [string, FileStat][], removed: boolean): Promise<void> {
        if (!todo.length) {
            if (removed || this.state !== 'ready') {
                this.touch();
                this.state = 'ready';
                this.updatedAt = Date.now();
                this.emit();
                this.scheduleSave();
            }
            return;
        }
        this.state = 'indexing';
        this.done = 0;
        this.total = todo.length;
        this.embedded = 0;
        this.reused = 0;
        this.error = undefined;
        this.emit();
        const pending = new Map<string, string>();
        for (const [rel, stat] of todo) {
            if (this.disposed) {
                return;
            }
            const chunks = await this.chunkFile(rel);
            if (chunks) {
                const stored = chunks.map(chunk => {
                    const hash = contentHash(chunk.text);
                    if (this.vectors.has(hash) || pending.has(hash)) {
                        this.reused++;
                    } else {
                        pending.set(hash, chunk.text);
                    }
                    return { start: chunk.startLine, end: chunk.endLine, hash };
                });
                this.files.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, chunks: stored });
            } else {
                this.files.delete(rel);
            }
            this.done++;
            if (pending.size >= EMBED_BATCH_SIZE) {
                await this.embedPending(pending);
            }
            if (this.done % INDEX_YIELD_EVERY === 0) {
                this.emit();
                await yieldToEventLoop();
            }
        }
        await this.embedPending(pending);
        this.touch();
        this.state = 'ready';
        this.updatedAt = Date.now();
        this.emit();
        this.scheduleSave();
    }

    protected async chunkFile(rel: string): Promise<TextChunk[] | undefined> {
        const text = await fs.promises.readFile(path.join(this.root, rel), 'utf8').catch(() => undefined);
        if (text === undefined || text.includes(NUL)) {
            return undefined;
        }
        const lines = text.split('\n').length;
        return text.length / lines > MAX_AVG_LINE_CHARS ? undefined : chunkText(text);
    }

    protected async embedPending(pending: Map<string, string>): Promise<void> {
        const items = [...pending];
        pending.clear();
        for (let at = 0; at < items.length; at += EMBED_BATCH_SIZE) {
            const batch = items.slice(at, at + EMBED_BATCH_SIZE);
            const vectors = await this.provider.embed(batch.map(([, text]) => text));
            batch.forEach(([hash], i) => this.vectors.set(hash, vectors[i]));
            this.embedded += batch.length;
        }
    }

    protected touch(): void {
        this.generation++;
        this.results.clear();
        this.fileLines.clear();
    }

    protected async linesOf(rel: string): Promise<string[] | undefined> {
        const known = this.fileLines.get(rel);
        if (known) {
            return known;
        }
        const text = await fs.promises.readFile(path.join(this.root, rel), 'utf8').catch(() => undefined);
        const lines = text?.split('\n');
        if (lines) {
            this.fileLines.set(rel, lines);
        }
        return lines;
    }

    protected scheduleSave(): void {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.enqueue(() => this.save()), SAVE_DEBOUNCE_MS);
    }

    /** Writes the manifest and the vectors. Unused vectors are kept up to a cap, so a branch switch back costs nothing. */
    async save(): Promise<void> {
        const used = new Set<string>();
        for (const entry of this.files.values()) {
            entry.chunks.forEach(chunk => used.add(chunk.hash));
        }
        const orphans = [...this.vectors.keys()].filter(hash => !used.has(hash));
        orphans.slice(0, Math.max(0, orphans.length - ORPHAN_VECTORS_KEPT)).forEach(hash => this.vectors.delete(hash));
        const dims = this.vectors.values().next().value?.length ?? 0;
        const hashes = [...this.vectors].filter(([, vector]) => vector.length === dims).map(([hash]) => hash);
        const floats = new Float32Array(hashes.length * dims);
        hashes.forEach((hash, i) => floats.set(this.vectors.get(hash) ?? [], i * dims));
        const manifest: IndexManifest = { version: INDEX_FORMAT_VERSION, provider: this.provider.key, dims, files: Object.fromEntries(this.files), vectors: hashes };
        try {
            await fs.promises.mkdir(this.indexDir, { recursive: true });
            await fs.promises.writeFile(path.join(this.indexDir, INDEX_GITIGNORE_FILE), INDEX_GITIGNORE_TEXT, { flag: 'wx' }).catch(() => undefined);
            await this.writeAtomic(INDEX_VECTORS_FILE, Buffer.from(floats.buffer));
            await this.writeAtomic(INDEX_MANIFEST_FILE, JSON.stringify(manifest));
        } catch {
            // A read-only folder keeps the index in memory only.
        }
    }

    protected async writeAtomic(name: string, data: string | Buffer): Promise<void> {
        const target = path.join(this.indexDir, name);
        const temp = `${target}.tmp`;
        await fs.promises.writeFile(temp, data);
        await fs.promises.rename(temp, target);
    }
}
