export interface PortInfo {
    readonly port: number;
    /** Bound addresses, e.g. `127.0.0.1`, `::1`, `*`. */
    readonly addresses: readonly string[];
    readonly pid?: number;
    readonly process?: string;
}

export interface KillResult {
    readonly ok: boolean;
    readonly message?: string;
}

export const PortsService = Symbol('IngotPortsService');

/** Lists listening TCP ports on this machine and stops the owning process on request (IDEA-24). */
export interface PortsService {
    list(): Promise<PortInfo[]>;
    kill(pid: number): Promise<KillResult>;
}
