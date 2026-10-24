import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/constants/app.consts';
import type { PublicUser } from '@/types/domain.types';
import { BEARER_PREFIX, HTTP_STATUS } from '@server/http/http.consts';
import { handle, json } from '@server/http/http';
import type { AuthedHandler, Handler } from '@server/http/http.types';
import { userIdForSession } from '@server/services/session.service';
import { userIdForAccessToken } from '@server/services/token.service';
import { findUserById } from '@server/services/user.service';

/** Current user from the session cookie, for server components and layouts. */
export async function getCurrentUser(): Promise<PublicUser | undefined> {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) { return undefined; }
    const userId = await userIdForSession(token);
    return userId ? findUserById(userId) : undefined;
}

async function resolveRequestUser(request: Request): Promise<PublicUser | undefined> {
    const header = request.headers.get('authorization');
    if (header?.startsWith(BEARER_PREFIX)) {
        const userId = await userIdForAccessToken(header.slice(BEARER_PREFIX.length).trim());
        return userId ? findUserById(userId) : undefined;
    }
    return getCurrentUser();
}

/** API guard: accepts the browser session cookie or an IDE access token (`Authorization: Bearer ingot_pat_...`). */
export function authed(handler: AuthedHandler): Handler {
    return handle(async (request, context) => {
        const user = await resolveRequestUser(request);
        if (!user) { return json({ error: 'unauthorized' }, HTTP_STATUS.unauthorized); }
        return handler(request, user, context);
    });
}
