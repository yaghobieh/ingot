import 'server-only';
import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';
import { getConfig } from '@server/config/config';

const globalForPool = globalThis as unknown as { ingotPool?: Pool };

function pool(): Pool {
    if (!globalForPool.ingotPool) {
        const { url } = getConfig().database;
        if (!url) { throw new Error('database.url is not configured in ingot.config.json'); }
        globalForPool.ingotPool = new Pool({ connectionString: url, max: 10 });
    }
    return globalForPool.ingotPool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await pool().query<T>(text, params);
    return result.rows;
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await query<T>(text, params);
    return rows[0];
}
