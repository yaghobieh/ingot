import 'server-only';
import { query } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { json } from '@server/http/http';

export async function health(): Promise<Response> {
    try {
        await query('SELECT 1');
        return json({ ok: true, db: true });
    } catch {
        return json({ ok: false, db: false }, HTTP_STATUS.unavailable);
    }
}
