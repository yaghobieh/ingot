import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type { KeyStoreService } from '@theia/core/lib/common/key-store';
import { DEV_FILE_KEYSTORE_ENV } from '../common/launch/keychain.consts';

type Store = Record<string, Record<string, string>>;

/**
 * Dev-only replacement for the OS keychain: secrets live in one JSON file (mode 0600) at the absolute path in
 * INGOT_DEV_FILE_KEYSTORE, e.g. under the preview's user-data folder, outside any repository. A re-signed dev bundle
 * otherwise makes macOS ask for keychain access after every rebuild. Values are never logged.
 */
@injectable()
export class DevFileKeyStoreService implements KeyStoreService {

    constructor(protected readonly file: string) {
        if (!path.isAbsolute(file)) {
            throw new Error(`${DEV_FILE_KEYSTORE_ENV} must be an absolute path.`);
        }
    }

    protected read(): Store {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Store : {};
        } catch {
            return {};
        }
    }

    protected write(store: Store): void {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const tmp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
        fs.chmodSync(this.file, 0o600);
    }

    async setPassword(service: string, account: string, password: string): Promise<void> {
        const store = this.read();
        store[service] = { ...(store[service] ?? {}), [account]: password };
        this.write(store);
    }

    async getPassword(service: string, account: string): Promise<string | undefined> {
        return this.read()[service]?.[account];
    }

    async deletePassword(service: string, account: string): Promise<boolean> {
        const store = this.read();
        if (!store[service] || !(account in store[service])) {
            return false;
        }
        delete store[service][account];
        this.write(store);
        return true;
    }

    async findPassword(service: string): Promise<string | undefined> {
        return Object.values(this.read()[service] ?? {})[0];
    }

    async findCredentials(service: string): Promise<Array<{ account: string; password: string }>> {
        return Object.entries(this.read()[service] ?? {}).map(([account, password]) => ({ account, password }));
    }

    async keys(service: string): Promise<string[]> {
        return Object.keys(this.read()[service] ?? {});
    }
}
