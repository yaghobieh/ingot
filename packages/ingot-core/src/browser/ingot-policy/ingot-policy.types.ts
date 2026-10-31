import type URI from '@theia/core/lib/common/uri';
import type { EffectivePolicy, ModelPrice, PackLock, PolicyLayer, PolicyViolation, ScopedPattern } from '../../common/ingot-kit';

export interface CachedLayer {
    layer?: PolicyLayer;
    errors: readonly string[];
}

export interface PolicyScan {
    layers: PolicyLayer[];
    errors: { file: string; errors: readonly string[] }[];
}

export interface Redactor {
    (text: string): { text: string; count: number };
}

/** One agent run (a user turn): the folder whose policy governs it, and what it has spent. */
export interface PolicyRunState {
    root?: URI;
    folder: string;
    policy: EffectivePolicy;
    /** Deny-read globs of every policy file in the project (each scoped to its folder). */
    denyRead: readonly ScopedPattern[];
    redact: Redactor;
    lock: PackLock;
    price: ModelPrice;
    spent: number;
    pendingInputTokens: number;
}

export interface RecordedViolation extends PolicyViolation {
    readonly at: number;
    readonly tool: string;
    readonly sessionId: string;
}

export interface EditCheck {
    readonly kept: readonly { readonly path: string }[];
    readonly refused: readonly string[];
}
