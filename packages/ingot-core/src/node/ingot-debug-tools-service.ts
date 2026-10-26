import { execFile } from 'child_process';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { RUNTIME_CHECK_TIMEOUT_MS, RUNTIME_COMMANDS, RUNTIME_EXTRA_PATHS } from '../common/debug/debug.consts';
import type { DebugRuntimeKind, DebugToolsService, RuntimeStatus } from '../common/debug/debug.types';
import { guidePlatform, parseRuntimeVersion } from '../common/debug/debug.utils';

interface RunResult {
    readonly ok: boolean;
    readonly output: string;
}

/** Checks for a JDK, PHP + Xdebug, Node.js or Python before a debug session starts (IDEA-138). */
@injectable()
export class IngotDebugToolsService implements DebugToolsService {

    protected readonly cache = new Map<DebugRuntimeKind, RuntimeStatus>();

    async check(kind: DebugRuntimeKind): Promise<RuntimeStatus> {
        const cached = this.cache.get(kind);
        if (cached?.found && (kind !== 'php' || cached.xdebug)) {
            return cached;
        }
        const { binaries, args } = RUNTIME_COMMANDS[kind];
        for (const binary of this.candidates(kind, binaries)) {
            const result = await this.run(binary, [...args]);
            if (result.ok) {
                const status: RuntimeStatus = { kind, found: true, ...parseRuntimeVersion(kind, result.output) };
                this.cache.set(kind, status);
                return status;
            }
        }
        return { kind, found: false };
    }

    protected candidates(kind: DebugRuntimeKind, binaries: readonly string[]): string[] {
        const javaHome = kind === 'java' && process.env.JAVA_HOME ? [path.join(process.env.JAVA_HOME, 'bin', 'java')] : [];
        return [...javaHome, ...binaries];
    }

    protected env(): NodeJS.ProcessEnv {
        const extra = RUNTIME_EXTRA_PATHS[guidePlatform(process.platform)];
        const current = (process.env.PATH ?? '').split(path.delimiter);
        return { ...process.env, PATH: [...current, ...extra.filter(p => !current.includes(p))].join(path.delimiter) };
    }

    protected run(command: string, args: string[]): Promise<RunResult> {
        return new Promise(resolve => {
            // macOS ships a /usr/bin/java stub that exits non-zero when no JDK is installed, so exit status decides.
            execFile(command, args, { timeout: RUNTIME_CHECK_TIMEOUT_MS, env: this.env(), windowsHide: true }, (error, stdout, stderr) => {
                resolve({ ok: !error, output: `${stdout}\n${stderr}` });
            });
        });
    }
}
