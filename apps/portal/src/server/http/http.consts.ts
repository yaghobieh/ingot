export const HTTP_STATUS = {
    ok: 200,
    created: 201,
    noContent: 204,
    found: 302,
    badRequest: 400,
    unauthorized: 401,
    forbidden: 403,
    notFound: 404,
    conflict: 409,
    gone: 410,
    tooMany: 429,
    serverError: 500,
    unavailable: 503
} as const;

export const BEARER_PREFIX = 'Bearer ';
export const MAX_JSON_BYTES = 262_144;
