// Applies db/migrations/*.sql in order, once each.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadDatabaseUrl } from './config.mjs';

const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const client = new pg.Client({ connectionString: loadDatabaseUrl() });
await client.connect();
try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
        if (done.has(file)) { continue; }
        await client.query('BEGIN');
        await client.query(readFileSync(`${dir}${file}`, 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migrated ${file}`);
    }
    console.log('migrations up to date');
} catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
} finally {
    await client.end();
}
