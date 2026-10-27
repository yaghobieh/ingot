import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type { PluginHostEnvironmentVariable } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { WATCHDOG_ENV, WATCHDOG_FILE_NAME, WATCHDOG_SOURCE, withWatchdogPreload } from '../common/lifecycle/plugin-host-watchdog';

/** IDEA-170: preloads the orphan watchdog into every plugin host this backend forks (see plugin-host-watchdog.ts). */
@injectable()
export class PluginHostWatchdog implements PluginHostEnvironmentVariable {

    protected file?: string;

    process(env: NodeJS.ProcessEnv): void {
        const file = this.ensureFile();
        if (!file) {
            return;
        }
        env[WATCHDOG_ENV] = '1';
        env.NODE_OPTIONS = withWatchdogPreload(env.NODE_OPTIONS, file);
    }

    protected ensureFile(): string | undefined {
        if (this.file) {
            return this.file;
        }
        try {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-ph-'));
            const file = path.join(dir, WATCHDOG_FILE_NAME);
            fs.writeFileSync(file, WATCHDOG_SOURCE, { mode: 0o600 });
            this.file = file;
            // Hosts load the file at start; remove it with the backend so temp dirs do not pile up.
            process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
            return file;
        } catch (error) {
            console.warn(`[ingot] Plugin host watchdog not installed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}
