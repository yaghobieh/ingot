import { execFile } from 'child_process';
import { injectable } from '@theia/core/shared/inversify';
import type { KillResult, PortInfo, PortsService } from '../common/ports/ports.types';
import { mergeListeners, parseLsof, parseNetstat, parseSs } from '../common/ports/ports.utils';

const run = (command: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 4 * 1024 * 1024, timeout: 5_000 }, (error, stdout) => {
        // lsof exits 1 when nothing matches; treat output as authoritative.
        if (error && !stdout) {
            reject(error);
        } else {
            resolve(stdout);
        }
    });
});

@injectable()
export class IngotPortsService implements PortsService {

    async list(): Promise<PortInfo[]> {
        if (process.platform === 'win32') {
            return mergeListeners(parseNetstat(await run('netstat', ['-ano', '-p', 'TCP'])));
        }
        try {
            return mergeListeners(parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])));
        } catch {
            return mergeListeners(parseSs(await run('ss', ['-ltnpH'])));
        }
    }

    async kill(pid: number): Promise<KillResult> {
        if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || pid === process.ppid) {
            return { ok: false, message: 'Refusing to stop this process.' };
        }
        try {
            process.kill(pid, 'SIGTERM');
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }
}
