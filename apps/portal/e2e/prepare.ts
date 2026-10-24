import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { E2E_BASE_URL, E2E_CONFIG_FILE, E2E_DIR } from '@e2e/e2e.consts';

/**
 * Prepares the THROWAWAY e2e database and a generated config (never committed):
 * the DB URL comes from E2E_DATABASE_URL (CI service container) or database.testUrl in ingot.config.json.
 */
export function prepareE2e(): string {
    const local = existsSync('ingot.config.json') ? JSON.parse(readFileSync('ingot.config.json', 'utf8')) : {};
    const url: string | undefined = process.env.E2E_DATABASE_URL || local?.database?.testUrl;
    if (!url) { throw new Error('Set E2E_DATABASE_URL or database.testUrl (a database whose name ends with _test)'); }
    mkdirSync(E2E_DIR, { recursive: true });
    writeFileSync(E2E_CONFIG_FILE, JSON.stringify({
        appUrl: E2E_BASE_URL,
        database: { url },
        security: { encryptionKey: randomBytes(32).toString('base64') },
        email: { provider: 'outbox' },
        billing: { provider: 'stub' },
        features: { devOutbox: true, sampleData: true }
    }), { mode: 0o600 });
    execFileSync(process.execPath, ['scripts/reset-test-db.mjs'], { stdio: 'inherit', env: { ...process.env, INGOT_DATABASE_URL: url } });
    return url;
}
