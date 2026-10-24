import 'server-only';
import { NextResponse } from 'next/server';
import { HTTP_STATUS, MAX_JSON_BYTES } from '@server/http/http.consts';
import type { Handler } from '@server/http/http.types';

export class HttpError extends Error {
    constructor(public readonly status: number, public readonly code: string) {
        super(code);
    }
}

export function json(data: unknown, status: number = HTTP_STATUS.ok): Response {
    return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(status: number, code: string): never {
    throw new HttpError(status, code);
}

export async function readJson<T>(request: Request): Promise<T> {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) { fail(HTTP_STATUS.badRequest, 'body_too_large'); }
    try {
        return (text ? JSON.parse(text) : {}) as T;
    } catch {
        return fail(HTTP_STATUS.badRequest, 'invalid_json');
    }
}

export function requireString(value: unknown, code: string, maxLength = 500): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) { fail(HTTP_STATUS.badRequest, code); }
    return value.trim();
}

/** Wraps a controller: maps HttpError to `{ error }` JSON and hides unexpected errors. */
export function handle(handler: Handler): Handler {
    return async (request, context) => {
        try {
            return await handler(request, context);
        } catch (error) {
            if (error instanceof HttpError) { return json({ error: error.code }, error.status); }
            console.error('[portal] unhandled error', error instanceof Error ? error.message : 'unknown');
            return json({ error: 'server_error' }, HTTP_STATUS.serverError);
        }
    };
}
