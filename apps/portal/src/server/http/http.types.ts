import type { PublicUser } from '@/types/domain.types';

export type RouteContext<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };
export type Handler = (request: Request, context: RouteContext) => Promise<Response>;
export type AuthedHandler = (request: Request, user: PublicUser, context: RouteContext) => Promise<Response>;
export type AuthSource = 'session' | 'token';
