import type { ApiOptions } from '@/client/api.types';

export class ApiError extends Error {
    constructor(public readonly status: number, public readonly code: string) {
        super(code);
    }
}

/** Browser fetch helper for the portal's own REST API (session cookie auth). */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const response = await fetch(path, {
        method: options.method ?? 'GET',
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) { throw new ApiError(response.status, data.error ?? 'generic'); }
    return data;
}

export function errorCode(error: unknown): string {
    return error instanceof ApiError ? error.code : 'generic';
}
