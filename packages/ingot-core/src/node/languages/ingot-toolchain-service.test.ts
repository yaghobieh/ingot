import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { PluginDeployerHandler } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { guidePlatform } from '../../common/debug/debug.utils';
import { TOOLCHAIN_OVERRIDES_ENV } from '../../common/languages/languages.consts';
import { IngotToolchainService } from './ingot-toolchain-service';

const IS_WINDOWS = process.platform === 'win32';

/** Only the temp folder is searched, so the machine's real tools never leak into the test. */
class TestToolchainService extends IngotToolchainService {
    constructor(protected readonly dirs: string[], plugins?: Partial<PluginDeployerHandler>) {
        super();
        (this as { plugins?: Partial<PluginDeployerHandler> }).plugins = plugins;
    }
    protected override searchPath(): string[] {
        return this.dirs;
    }
}

const script = (dir: string, name: string, output: string, code: number): void => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\necho "${output}"\nexit ${code}\n`);
    fs.chmodSync(file, 0o755);
};

describe.skipIf(IS_WINDOWS)('IngotToolchainService', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-toolchains-'));
    });

    afterEach(() => {
        delete process.env[TOOLCHAIN_OVERRIDES_ENV];
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('finds a tool by exit status and reads its version', async () => {
        script(dir, 'go', 'go version go1.23.2 darwin/arm64', 0);
        script(dir, 'php', 'PHP is broken', 1);
        const service = new TestToolchainService([dir]);
        const [go, php, cargo] = await service.check(['go', 'php', 'cargo']);
        expect(go).toEqual({ id: 'go', found: true, version: '1.23.2', path: path.join(dir, 'go') });
        expect(php).toEqual({ id: 'php', found: false });
        expect(cargo).toEqual({ id: 'cargo', found: false });
    });

    it('tries the next probe and flags a too-old version', async () => {
        script(dir, 'python', 'Python 3.12.1', 0);
        script(dir, 'ruby', 'ruby 2.6.10p210', 0);
        const [python, ruby] = await new TestToolchainService([dir]).check(['python', 'ruby']);
        expect(python).toMatchObject({ found: true, version: '3.12.1' });
        expect(ruby).toMatchObject({ found: true, version: '2.6.10', tooOld: true });
    });

    it('caches until refresh', async () => {
        const service = new TestToolchainService([dir]);
        expect((await service.check(['go']))[0].found).toBe(false);
        script(dir, 'go', 'go version go1.23.2', 0);
        expect((await service.check(['go']))[0].found).toBe(false);
        await service.refresh();
        expect((await service.check(['go']))[0].found).toBe(true);
    });

    it('gives Run a temp folder, the searched PATH and the backend OS', async () => {
        const context = await new TestToolchainService([dir, '/extra/bin']).runContext();
        expect(fs.existsSync(context.tmpdir)).toBe(true);
        expect(context.path).toBe([dir, '/extra/bin'].join(path.delimiter));
        expect(context.platform).toBe(guidePlatform(process.platform));
    });

    it('applies the override file', async () => {
        script(dir, 'go', 'go version go1.23.2', 0);
        const overrides = path.join(dir, 'overrides.json');
        fs.writeFileSync(overrides, JSON.stringify({ go: 'missing' }));
        process.env[TOOLCHAIN_OVERRIDES_ENV] = overrides;
        expect((await new TestToolchainService([dir]).check(['go']))[0]).toEqual({ id: 'go', found: false });
    });

    it('falls back to the JDK bundled in redhat.java and lists deployed extensions', async () => {
        const extension = path.join(dir, 'redhat.java');
        const home = path.join(extension, 'jre', '25.0.4.1-test');
        fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
        script(path.join(home, 'bin'), 'java', 'openjdk version "25.0.4.1"', 0);
        fs.writeFileSync(path.join(home, 'release'), 'JAVA_VERSION="25.0.4.1"\n');
        const plugin = { metadata: { model: { id: 'redhat.java', packageUri: FileUri.create(extension).toString() } } };
        const plugins = {
            getDeployedPluginsById: () => [plugin],
            getDeployedPlugins: async () => [plugin, { metadata: { model: { id: 'golang.Go', packageUri: '' } } }]
        } as unknown as Partial<PluginDeployerHandler>;
        const service = new TestToolchainService([path.join(dir, 'empty')], plugins);
        const [jre, jdk, go] = await service.check(['jre', 'jdk', 'go']);
        expect(jre).toEqual({ id: 'jre', found: true, bundled: true, path: home, version: '25.0.4.1' });
        expect(jdk).toMatchObject({ id: 'jdk', found: true, bundled: true });
        expect(go.found).toBe(false);
        expect(await service.installedExtensions()).toEqual(['redhat.java', 'golang.go']);
    });
});
