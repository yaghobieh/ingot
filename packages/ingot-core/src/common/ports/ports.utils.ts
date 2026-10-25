import { WILDCARD_ADDRESSES } from './ports.consts';
import type { PortInfo } from './ports.types';

interface RawListener {
    readonly port: number;
    readonly address: string;
    readonly pid?: number;
    readonly process?: string;
}

/** Splits `host:port`, `[::1]:port` or `*:port` into its parts. */
export const splitAddress = (value: string): { address: string; port: number } | undefined => {
    const match = /^(.*):(\d+)$/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    return { address: match[1].replace(/^\[(.*)\]$/, '$1') || '*', port: Number(match[2]) };
};

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` field output (macOS, Linux). */
export const parseLsof = (output: string): RawListener[] => {
    const result: RawListener[] = [];
    let pid: number | undefined;
    let command: string | undefined;
    for (const line of output.split('\n')) {
        const field = line[0];
        const value = line.slice(1);
        if (field === 'p') {
            pid = Number(value);
            command = undefined;
        } else if (field === 'c') {
            command = value;
        } else if (field === 'n') {
            const parsed = splitAddress(value.split('->')[0]);
            if (parsed) {
                result.push({ ...parsed, pid, process: command });
            }
        }
    }
    return result;
};

/** Parses `ss -ltnpH` output (Linux without lsof). */
export const parseSs = (output: string): RawListener[] =>
    output.split('\n').map(line => line.trim()).filter(Boolean).flatMap(line => {
        const columns = line.split(/\s+/);
        const parsed = splitAddress(columns[3] ?? '');
        if (!parsed) {
            return [];
        }
        const user = /\("([^"]+)",pid=(\d+)/.exec(line);
        return [{ ...parsed, pid: user ? Number(user[2]) : undefined, process: user?.[1] }];
    });

/** Parses `netstat -ano -p TCP` output (Windows). */
export const parseNetstat = (output: string): RawListener[] =>
    output.split('\n').map(line => line.trim().split(/\s+/)).filter(cols => cols[0] === 'TCP' && cols[3] === 'LISTENING').flatMap(cols => {
        const parsed = splitAddress(cols[1]);
        return parsed ? [{ ...parsed, pid: Number(cols[4]) }] : [];
    });

/** Merges IPv4/IPv6 duplicates of the same listener and sorts by port. */
export const mergeListeners = (listeners: readonly RawListener[]): PortInfo[] => {
    const merged = new Map<string, { port: number; addresses: string[]; pid?: number; process?: string }>();
    for (const l of listeners) {
        const key = `${l.port}|${l.pid ?? ''}`;
        const existing = merged.get(key);
        if (existing) {
            if (!existing.addresses.includes(l.address)) {
                existing.addresses.push(l.address);
            }
        } else {
            merged.set(key, { port: l.port, addresses: [l.address], pid: l.pid, process: l.process });
        }
    }
    return [...merged.values()].sort((a, b) => a.port - b.port);
};

const isWildcard = (address: string): boolean => (WILDCARD_ADDRESSES as readonly string[]).includes(address);

/** URL to open a listening port in the browser. Wildcard and IPv6 loopback binds open on `localhost`. */
export const portUrl = (info: PortInfo): string => {
    const specific = info.addresses.find(a => !isWildcard(a));
    const host = !specific || specific === '::1' ? 'localhost' : specific.includes(':') ? `[${specific}]` : specific;
    return `http://${host}:${info.port}`;
};

export const filterPorts = (ports: readonly PortInfo[], query: string): PortInfo[] => {
    const q = query.trim().toLowerCase();
    return q ? ports.filter(p => String(p.port).includes(q) || (p.process ?? '').toLowerCase().includes(q) || String(p.pid ?? '').includes(q)) : [...ports];
};
