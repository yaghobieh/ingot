import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DevFileKeyStoreService } from './dev-file-key-store';

describe('DevFileKeyStoreService', () => {
    it('stores, lists and deletes secrets in a 0600 file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-ks-'));
        const file = path.join(dir, 'sub', 'dev-secrets.json');
        const store = new DevFileKeyStoreService(file);
        expect(await store.getPassword('svc', 'a')).toBeUndefined();
        await store.setPassword('svc', 'a', 'one');
        await store.setPassword('svc', 'b', 'two');
        expect(await store.getPassword('svc', 'a')).toBe('one');
        expect(await store.keys('svc')).toEqual(['a', 'b']);
        expect(await store.findCredentials('svc')).toHaveLength(2);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(await store.deletePassword('svc', 'a')).toBe(true);
        expect(await store.deletePassword('svc', 'a')).toBe(false);
        expect(await new DevFileKeyStoreService(file).keys('svc')).toEqual(['b']);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    it('needs an absolute path', () => {
        expect(() => new DevFileKeyStoreService('relative.json')).toThrow(/absolute/);
    });
});
