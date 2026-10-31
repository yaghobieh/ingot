import type { LockIssue, OrgPack, PackLock, PackVersionInfo } from '../ingot-kit';

export const RulePacksService = Symbol('IngotRulePacksService');

export interface RulePackResult {
    readonly ok: boolean;
    readonly message: string;
    readonly lock: PackLock;
}

export interface RulePackVersions {
    readonly id: string;
    readonly latest: string;
    readonly versions: readonly PackVersionInfo[];
    /** The version the range installs, resolved locally. */
    readonly resolved?: string;
}

export interface TeamPacksResult {
    readonly signedIn: boolean;
    readonly team?: string;
    readonly packs: readonly OrgPack[];
    readonly error?: string;
}

/** IDEA-322: Store rule packs for a project (`root` is its absolute folder). The backend talks to the Store. */
export interface RulePacksService {
    lock(root: string): Promise<PackLock>;
    versions(spec: string): Promise<RulePackVersions>;
    /** `@acme/react-rules@^2`: resolves, downloads, checks and installs; writes `.ingot/ingot-lock.json`. */
    add(root: string, spec: string): Promise<RulePackResult>;
    remove(root: string, key: string): Promise<RulePackResult>;
    /** Every locked pack at its locked version (fresh clones). */
    install(root: string): Promise<RulePackResult>;
    /** Moves packs to the newest version inside their range. */
    update(root: string): Promise<RulePackResult>;
    /** The signed-in account's team packs from the Store. */
    teamPacks(): Promise<TeamPacksResult>;
    /** Installs the team's packs; enforced ones are marked and cannot be removed or overridden. */
    syncOrg(root: string): Promise<RulePackResult>;
    verify(root: string): Promise<readonly LockIssue[]>;
}
