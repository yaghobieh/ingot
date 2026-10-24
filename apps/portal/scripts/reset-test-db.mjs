// Drops and recreates the public schema of the THROWAWAY test database, then migrates.
// Refuses to run unless the database name ends with _test.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadDatabaseUrl } from './config.mjs';

const url = loadDatabaseUrl();
const dbName = new URL(url).pathname.replace('/', '');
if (!dbName.endsWith('_test')) { throw new Error('reset-test-db only runs against a database whose name ends with _test'); }
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await client.end();
execFileSync(process.execPath, [fileURLToPath(new URL('./migrate.mjs', import.meta.url))], { stdio: 'inherit', env: process.env });
