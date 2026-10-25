import { describe, expect, it } from 'vitest';
import { filterPorts, mergeListeners, parseLsof, parseNetstat, parseSs, portUrl, splitAddress } from './ports.utils';

describe('ports utils', () => {
    it('splits IPv4, IPv6 and wildcard addresses', () => {
        expect(splitAddress('127.0.0.1:3100')).toEqual({ address: '127.0.0.1', port: 3100 });
        expect(splitAddress('[::1]:5173')).toEqual({ address: '::1', port: 5173 });
        expect(splitAddress('*:8080')).toEqual({ address: '*', port: 8080 });
        expect(splitAddress('nonsense')).toBeUndefined();
    });

    it('parses lsof field output and merges v4/v6 duplicates', () => {
        const out = 'p101\ncnode\nf20\nn127.0.0.1:3100\nf21\nn[::1]:3100\np202\ncpostgres\nf5\nn*:5432\n';
        expect(mergeListeners(parseLsof(out))).toEqual([
            { port: 3100, addresses: ['127.0.0.1', '::1'], pid: 101, process: 'node' },
            { port: 5432, addresses: ['*'], pid: 202, process: 'postgres' }
        ]);
    });

    it('parses ss output', () => {
        const out = 'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=77,fd=19))\n';
        expect(parseSs(out)).toEqual([{ address: '0.0.0.0', port: 3000, pid: 77, process: 'node' }]);
    });

    it('parses Windows netstat output', () => {
        const out = '  Proto  Local Address  Foreign Address  State  PID\n  TCP    0.0.0.0:135   0.0.0.0:0   LISTENING   912\n  TCP 10.0.0.2:5000 1.2.3.4:443 ESTABLISHED 4\n';
        expect(parseNetstat(out)).toEqual([{ address: '0.0.0.0', port: 135, pid: 912 }]);
    });

    it('builds browser URLs and filters', () => {
        expect(portUrl({ port: 3000, addresses: ['*'] })).toBe('http://localhost:3000');
        expect(portUrl({ port: 3100, addresses: ['127.0.0.1'] })).toBe('http://127.0.0.1:3100');
        expect(portUrl({ port: 5173, addresses: ['::1'] })).toBe('http://localhost:5173');
        expect(filterPorts([{ port: 1, addresses: [], process: 'node' }, { port: 2, addresses: [], process: 'redis' }], 'red')).toHaveLength(1);
    });
});
