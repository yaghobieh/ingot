// Loads the portal config for node scripts. Never prints values.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = fileURLToPath(new URL('../ingot.config.json', import.meta.url));

export function loadDatabaseUrl() {
    if (process.env.INGOT_DATABASE_URL) { return process.env.INGOT_DATABASE_URL; }
    const path = process.env.INGOT_CONFIG ?? DEFAULT_PATH;
    if (!existsSync(path)) { throw new Error('ingot.config.json not found (copy ingot.config.example.json)'); }
    const url = JSON.parse(readFileSync(path, 'utf8'))?.database?.url;
    if (!url) { throw new Error('database.url is missing in ingot.config.json'); }
    return url;
}
