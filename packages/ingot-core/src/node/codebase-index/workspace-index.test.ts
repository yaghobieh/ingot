import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceIndex } from './workspace-index';
import { LocalEmbeddingProvider } from './embedding-providers';
import { CodebaseIndexConnection, IngotCodebaseIndexService } from './ingot-codebase-index-service';
import { DEFAULT_EMBEDDING_PROVIDER, INDEX_DIR, INDEX_MANIFEST_FILE } from '../../common/codebase-index/codebase-index.consts';

/** Counts embedded texts, to prove unchanged chunks are never embedded twice. */
class CountingProvider extends LocalEmbeddingProvider {
    count = 0;
    override async embed(texts: readonly string[]): Promise<Float32Array[]> {
        this.count += texts.length;
        return super.embed(texts);
    }
}

const write = (root: string, rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
};

describe('IDEA-260 workspace index', () => {
    let root: string;
    let provider: CountingProvider;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-index-')));
        provider = new CountingProvider();
        write(root, 'src/pricing.ts', 'export const roundPrice = (price: number): number => Math.round(price * 100) / 100;\n');
        write(root, 'src/auth.ts', 'export const login = async (user: string, password: string) => session.start(user, password);\n');
        write(root, 'README.md', '# Shop\nA small shop.\n');
        write(root, '.env', 'API_KEY=roundPrice-secret\n');
        write(root, 'dist/bundle.js', 'const roundPrice = 1;\n');
        write(root, 'generated/out.ts', 'export const roundPrice = 2;\n');
        write(root, '.gitignore', 'generated/\n');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('indexes text files, skips secrets, build output and ignored folders, and ranks the right file first', async () => {
        const index = new WorkspaceIndex(root, provider);
        await index.sync();
        expect(index.status()).toMatchObject({ state: 'ready', files: 3 });
        const result = await index.search('where are prices rounded');
        expect(result.hits[0].path).toBe('src/pricing.ts');
        expect(result.hits.map(h => h.path)).not.toContain('.env');
        expect(result.hits.map(h => h.path)).not.toContain('generated/out.ts');
        expect((await index.search('where are prices rounded')).cached).toBe(true);
        expect((await index.search('login', { path: 'src/pricing.ts' })).hits.every(h => h.path === 'src/pricing.ts')).toBe(true);
        index.dispose();
    });

    it('re-embeds only changed chunks, and reuses every embedding after a reload or rebuild', async () => {
        const index = new WorkspaceIndex(root, provider);
        await index.sync();
        const first = provider.count;
        await index.sync();
        expect(provider.count).toBe(first);

        write(root, 'src/cart.ts', 'export const addToCart = (cart: string[], item: string) => [...cart, item];\n');
        await index.update(['src/cart.ts']);
        expect(provider.count).toBe(first + 1);
        expect((await index.search('add item to cart')).hits[0].path).toBe('src/cart.ts');

        fs.rmSync(path.join(root, 'src/cart.ts'));
        await index.update(['src/cart.ts']);
        expect((await index.search('add item to cart')).hits.map(h => h.path)).not.toContain('src/cart.ts');

        await index.save();
        index.dispose();
        expect(fs.existsSync(path.join(root, INDEX_DIR, INDEX_MANIFEST_FILE))).toBe(true);
        expect(fs.readFileSync(path.join(root, INDEX_DIR, '.gitignore'), 'utf8')).toBe('*\n');

        const reloaded = new WorkspaceIndex(root, provider);
        await reloaded.load();
        const before = provider.count;
        await reloaded.sync(true);
        expect(provider.count).toBe(before);
        expect(reloaded.status()).toMatchObject({ files: 3, embedded: 0, reused: 3 });
        reloaded.dispose();
    });

    it('re-indexes changed paths reported by the file watcher, ignoring its own index files', async () => {
        const index = new WorkspaceIndex(root, provider);
        await index.sync();
        await index.search('shipping cost by weight');
        const before = provider.count;
        write(root, 'src/shipping.ts', 'export const shippingCost = (weightKg: number) => weightKg * 4.5;\n');
        index.notifyChanged([`${INDEX_DIR}/${INDEX_MANIFEST_FILE}`, 'src/shipping.ts']);
        await expect.poll(async () => (await index.search('shipping cost by weight')).hits[0]?.path, { timeout: 5000 }).toBe('src/shipping.ts');
        expect(provider.count).toBe(before + 1);
        index.dispose();
    });

    it('keeps an index open while any window has it and releases it when the last one disconnects', async () => {
        const service = new IngotCodebaseIndexService();
        const first = new CodebaseIndexConnection(service);
        const second = new CodebaseIndexConnection(service);
        const settings = { provider: DEFAULT_EMBEDDING_PROVIDER };
        await first.open(root, settings);
        await first.open(root, settings);
        await second.open(root, settings);
        first.dispose();
        expect(service.isOpen(root)).toBe(true);
        await second.close(root);
        expect(service.isOpen(root)).toBe(false);
        service.dispose();
    });
});
