/**
 * IDEA-185: Harmony handoff from Ingot to the Zaprex desktop app (protocol v1, see docs/zaprex-handoff.md).
 *
 * 1. Ingot keeps the piece on a loopback-only HTTP endpoint (127.0.0.1, random port) behind a one-time token.
 * 2. Ingot opens `zaprex://harmony?v=1&id=…&port=…&token=…&from=ingot`.
 * 3. Zaprex claims the piece (GET), streams status (POST …/status) and returns its edits (POST …/result).
 * 4. Ingot shows the piece as a T-rex subagent, the lead agent waits on it, and Zaprex's edits go through the review bar.
 */
import { inScope } from '../agents/harmony';
import type { HarmonyPieceKind } from '../agents/harmony';
import { isSafeRelativePath } from '../groups/channel.utils';

export const ZAPREX_HANDOFF_VERSION = 1;
export const ZAPREX_SCHEME = 'zaprex';
/** Opens the desktop app (no piece). */
export const ZAPREX_OPEN_LINK = 'zaprex://open?from=ingot';
/** Web fallback when the desktop app is not installed: download for this OS, or "Stay here" (web cannot take pieces). */
export const ZAPREX_WEB_FALLBACK = 'https://zaprex.dev/app?from=ingot';
/** The token is good for claiming for this long; after the claim it is bound to the piece until it ends. */
export const HANDOFF_CLAIM_TTL_MS = 10 * 60_000;
/** How often Ingot reads a piece's status while Zaprex works. */
export const HANDOFF_POLL_MS = 1000;
export const HANDOFF_MAX_CONTEXT_FILES = 12;
export const HANDOFF_MAX_CONTEXT_CHARS = 60_000;
export const HANDOFF_MAX_BODY_BYTES = 4 * 1024 * 1024;

export type ZaprexPlatform = 'mac' | 'windows' | 'linux';
export interface ZaprexDesktopInfo {
    readonly installed: boolean;
    readonly platform: ZaprexPlatform;
}

export interface HandoffFile {
    readonly path: string;
    readonly content: string;
}

/** What Zaprex gets for its piece (GET /v1/handoff/:id). */
export interface HarmonyHandoff {
    readonly v: typeof ZAPREX_HANDOFF_VERSION;
    readonly id: string;
    readonly source: 'ingot';
    readonly kind: HarmonyPieceKind;
    readonly label: string;
    /** Exactly what to do, e.g. "Write the tests for: add CSV export". */
    readonly task: string;
    /** The user's request the lead agent works on. */
    readonly goal: string;
    /** What the Ingot agent does meanwhile ("Working on <task> while Ingot works on <lead.task>"). */
    readonly lead: { readonly title: string; readonly task: string };
    /** Globs Zaprex may change. Ingot's agent is locked out of them until the piece ends; Zaprex is locked into them. */
    readonly scope: readonly string[];
    readonly repo: { readonly path: string; readonly branch?: string; readonly head?: string };
    /** Relevant code: files in scope that exist plus the files the lead agent is changing (capped). */
    readonly context: readonly HandoffFile[];
    readonly createdAt: number;
}

export type HandoffState = 'pending' | 'claimed' | 'working' | 'done' | 'failed' | 'cancelled';
export const HANDOFF_ACTIVE: readonly HandoffState[] = ['pending', 'claimed', 'working'];

export interface HandoffResult {
    readonly summary: string;
    readonly edits: readonly HandoffFile[];
}

export interface HandoffStatus {
    readonly id: string;
    readonly state: HandoffState;
    /** 0..1 */
    readonly progress?: number;
    readonly message?: string;
    readonly updatedAt: number;
    readonly result?: HandoffResult;
}

export const handoffDeepLink = (id: string, port: number, token: string): string =>
    `${ZAPREX_SCHEME}://harmony?v=${ZAPREX_HANDOFF_VERSION}&id=${encodeURIComponent(id)}&port=${port}&token=${encodeURIComponent(token)}&from=ingot`;

/** Parses a handoff deep link (the desktop app does the same). */
export const parseHandoffLink = (link: string): { id: string; port: number; token: string; v: number } | undefined => {
    const m = /^zaprex:\/\/harmony\?(.*)$/.exec(link.trim());
    if (!m) {
        return undefined;
    }
    const q = new URLSearchParams(m[1]);
    const port = Number(q.get('port'));
    const id = q.get('id') ?? '';
    const token = q.get('token') ?? '';
    return id && token && Number.isInteger(port) && port > 0 && port < 65536 ? { id, port, token, v: Number(q.get('v') ?? '0') } : undefined;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** POST /v1/handoff/:id/status body: `{ state: "working" | "failed" | "cancelled", progress?, message? }`. */
export const parseStatusBody = (body: unknown): { state: 'working' | 'failed' | 'cancelled'; progress?: number; message?: string } | { error: string } => {
    if (!isObj(body) || !['working', 'failed', 'cancelled'].includes(String(body.state))) {
        return { error: 'state must be "working", "failed" or "cancelled" (send the result to /result).' };
    }
    const progress = typeof body.progress === 'number' && body.progress >= 0 && body.progress <= 1 ? body.progress : undefined;
    const message = typeof body.message === 'string' ? body.message.slice(0, 500) : undefined;
    return { state: body.state as 'working' | 'failed' | 'cancelled', ...(progress !== undefined ? { progress } : {}), ...(message ? { message } : {}) };
};

/** POST /v1/handoff/:id/result body: `{ summary, edits: [{ path, content }] }`. Every path must be inside the piece's scope. */
export const parseResultBody = (body: unknown, scope: readonly string[]): HandoffResult | { error: string } => {
    if (!isObj(body) || !Array.isArray(body.edits)) {
        return { error: 'Expected { summary, edits: [{ path, content }] }.' };
    }
    const edits: HandoffFile[] = [];
    for (const e of body.edits) {
        if (!isObj(e) || typeof e.path !== 'string' || typeof e.content !== 'string') {
            return { error: 'Each edit needs a string path and content.' };
        }
        if (!isSafeRelativePath(e.path)) {
            return { error: `"${e.path}" is not a project-relative path.` };
        }
        if (!inScope(scope, e.path)) {
            return { error: `"${e.path}" is outside this piece (${scope.join(', ')}).` };
        }
        edits.push({ path: e.path, content: e.content });
    }
    return { summary: typeof body.summary === 'string' ? body.summary.slice(0, 2000) : '', edits };
};

/** The line Zaprex shows, and the subagent row's text in Ingot. */
export const workingLine = (h: Pick<HarmonyHandoff, 'label' | 'lead'>): string => `Working on ${h.label} while Ingot works on ${h.lead.title}`;
