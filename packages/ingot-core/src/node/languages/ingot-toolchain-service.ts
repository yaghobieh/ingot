import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { PluginDeployerHandler } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { guidePlatform } from '../../common/debug/debug.utils';
import {
    BUNDLED_JAVA_TOOLCHAINS, BUNDLED_JRE_EXTENSION, BUNDLED_JRE_FOLDER, TOOLCHAIN_CHECK_TIMEOUT_MS, TOOLCHAIN_EXTRA_PATHS, TOOLCHAIN_IDS, TOOLCHAIN_OVERRIDES_ENV,
    TOOLCHAINS, XCODE_SHIM_DIR, XCODE_SHIMS
} from '../../common/languages/languages.consts';
import type { RunContext, ToolchainId, ToolchainProbe, ToolchainService, ToolchainStatus } from '../../common/languages/languages.types';
import { applyOverride, bundledJavaStatus, parseOverrides, toolchainStatusFrom } from '../../common/languages/languages.utils';

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME_PREFIX = '~/';
const RELEASE_FILE = 'release';
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];
const RUN_TMP_FOLDER = 'ingot-run';

interface ProbeResult {
    readonly ok: boolean;
    readonly output: string;
}

/**
 * IDEA-313: finds compilers, runtimes and toolchains (exit status decides, so the macOS /usr/bin/java stub counts as missing).
 * Results are cached until `refresh`; the bundled JDK inside redhat.java stands in for a missing Java.
 */
@injectable()
export class IngotToolchainService implements ToolchainService {

    @inject(PluginDeployerHandler) @optional() protected readonly plugins?: PluginDeployerHandler;

    protected cache = new Map<ToolchainId, Promise<ToolchainStatus>>();
    protected xcodeTools?: Promise<boolean>;

    async check(ids: readonly ToolchainId[] = TOOLCHAIN_IDS): Promise<ToolchainStatus[]> {
        const overrides = parseOverrides(await this.readOverrides());
        return Promise.all(ids.filter(id => TOOLCHAINS[id]).map(async id => applyOverride(await this.status(id), overrides[id])));
    }

    async refresh(): Promise<void> {
        this.cache.clear();
        this.xcodeTools = undefined;
    }

    async installedExtensions(): Promise<string[]> {
        const deployed = await this.plugins?.getDeployedPlugins().catch(() => []) ?? [];
        return [...new Set(deployed.map(p => p.metadata.model.id.toLowerCase()))];
    }

    async runContext(): Promise<RunContext> {
        const tmpdir = path.join(os.tmpdir(), RUN_TMP_FOLDER);
        await fs.promises.mkdir(tmpdir, { recursive: true });
        return { tmpdir, path: this.searchPath().join(path.delimiter), platform: guidePlatform(process.platform) };
    }

    protected status(id: ToolchainId): Promise<ToolchainStatus> {
        let pending = this.cache.get(id);
        if (!pending) {
            pending = this.detect(id);
            this.cache.set(id, pending);
        }
        return pending;
    }

    protected async detect(id: ToolchainId): Promise<ToolchainStatus> {
        for (const probe of TOOLCHAINS[id].probes) {
            const binary = await this.resolve(probe.command);
            if (!binary || !(await this.mayRun(probe, binary))) {
                continue;
            }
            const result = await this.run(binary, probe.args);
            if (result.ok) {
                return toolchainStatusFrom(id, true, result.output, binary);
            }
        }
        if (!BUNDLED_JAVA_TOOLCHAINS.includes(id)) {
            return { id, found: false };
        }
        const bundled = await this.bundledJava(id);
        if (!bundled) {
            // A deploy still in progress has no redhat.java yet; look again next time.
            this.cache.delete(id);
        }
        return bundled ?? { id, found: false };
    }

    /** The JDK bundled in redhat.java (`<extension>/jre/<version>`), if that extension is deployed. */
    protected async bundledJava(id: ToolchainId): Promise<ToolchainStatus | undefined> {
        const plugin = this.plugins?.getDeployedPluginsById(BUNDLED_JRE_EXTENSION)[0];
        if (!plugin) {
            return undefined;
        }
        const root = path.join(FileUri.fsPath(plugin.metadata.model.packageUri), BUNDLED_JRE_FOLDER);
        const versions = await fs.promises.readdir(root).catch(() => [] as string[]);
        for (const version of versions) {
            const home = path.join(root, version);
            const launcher = path.join(home, 'bin', IS_WINDOWS ? 'java.exe' : 'java');
            if (await this.executable(launcher)) {
                const release = await fs.promises.readFile(path.join(home, RELEASE_FILE), 'utf8').catch(() => '');
                return bundledJavaStatus(id, home, release);
            }
        }
        return undefined;
    }

    /** macOS without Command Line Tools: running a /usr/bin shim opens the install dialog, so it counts as missing. */
    protected async mayRun(probe: ToolchainProbe, binary: string): Promise<boolean> {
        if (!IS_MAC || !XCODE_SHIMS.has(probe.command) || path.dirname(binary) !== XCODE_SHIM_DIR) {
            return true;
        }
        this.xcodeTools ??= this.run('/usr/bin/xcode-select', ['-p']).then(r => r.ok);
        return this.xcodeTools;
    }

    protected searchPath(): string[] {
        const home = os.homedir();
        const extra = TOOLCHAIN_EXTRA_PATHS[guidePlatform(process.platform)].map(p => p.startsWith(HOME_PREFIX) ? path.join(home, p.slice(HOME_PREFIX.length)) : p);
        const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
        return [...current, ...extra.filter(p => !current.includes(p))];
    }

    /** The absolute path of a command on PATH (plus the extra folders), like `which`. */
    protected async resolve(command: string): Promise<string | undefined> {
        const names = IS_WINDOWS ? [command, ...WINDOWS_EXTENSIONS.map(e => `${command}${e}`)] : [command];
        for (const dir of this.searchPath()) {
            for (const name of names) {
                const candidate = path.join(dir, name);
                if (await this.executable(candidate)) {
                    return candidate;
                }
            }
        }
        return undefined;
    }

    protected async executable(file: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(file);
            if (!stat.isFile()) {
                return false;
            }
            await fs.promises.access(file, IS_WINDOWS ? fs.constants.F_OK : fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    }

    protected run(command: string, args: readonly string[]): Promise<ProbeResult> {
        return new Promise(resolve => {
            const env = { ...process.env, PATH: this.searchPath().join(path.delimiter) };
            execFile(command, [...args], { timeout: TOOLCHAIN_CHECK_TIMEOUT_MS, env, windowsHide: true, shell: IS_WINDOWS && /\.(cmd|bat)$/i.test(command) }, (error, stdout, stderr) => {
                resolve({ ok: !error, output: `${stdout}\n${stderr}` });
            });
        });
    }

    protected async readOverrides(): Promise<string | undefined> {
        const file = process.env[TOOLCHAIN_OVERRIDES_ENV];
        return file ? fs.promises.readFile(file, 'utf8').catch(() => undefined) : undefined;
    }
}
