import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { IMPORT_HOME_ENV } from '../common/project-config/project-config.consts';
import { DEPLOYED_PLUGINS_DIR, EXTENSION_DIRS, latestPerId, mergeKeybindings, mergeSettings, OPENVSX_URL, OPENVSX_URL_ENV, openVsxPath, parseExtensionFolder, parseExtensionsManifest, parseJsonc, userSettingsDirs, usesUnsupportedApi } from '../common/import/editor-import';
import type { DetectedExtension, EditorImportService, ImportSource, PreparedExtension, SettingsImportResult } from '../common/import/editor-import.types';

const OPENVSX_TIMEOUT_MS = 20_000;

const readJson = (file: string): unknown => parseJsonc(fs.readFileSync(file, 'utf8'));
const exists = (file: string): boolean => {
    try {
        fs.accessSync(file);
        return true;
    } catch {
        return false;
    }
};

/** IDEA-107: reads other editors' extension folders and settings, fetches the same extensions from Open VSX. */
@injectable()
export class IngotEditorImportService implements EditorImportService {

    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected get home(): string {
        return process.env[IMPORT_HOME_ENV] || os.homedir();
    }

    protected get openVsx(): string {
        return (process.env[OPENVSX_URL_ENV] || OPENVSX_URL).replace(/\/$/, '');
    }

    async detect(): Promise<ImportSource[]> {
        const sources: ImportSource[] = [];
        EXTENSION_DIRS.forEach((dir, index) => {
            const root = path.join(this.home, dir);
            const extensions = exists(root) ? this.readExtensions(root) : [];
            const settingsDir = userSettingsDirs(process.platform, index).map(d => path.join(this.home, d)).find(exists);
            const settingsFile = settingsDir && exists(path.join(settingsDir, 'settings.json')) ? path.join(settingsDir, 'settings.json') : undefined;
            const keybindingsFile = settingsDir && exists(path.join(settingsDir, 'keybindings.json')) ? path.join(settingsDir, 'keybindings.json') : undefined;
            if (extensions.length || settingsFile || keybindingsFile) {
                sources.push({ path: root, extensions, settingsFile, keybindingsFile });
            }
        });
        return sources;
    }

    protected readExtensions(root: string): DetectedExtension[] {
        const found: DetectedExtension[] = [];
        const manifest = path.join(root, 'extensions.json');
        const listed = exists(manifest) ? parseExtensionsManifest(fs.readFileSync(manifest, 'utf8')) : [];
        const folders = listed.length
            ? listed.map(e => ({ id: e.id, version: e.version, folder: path.isAbsolute(e.location) ? e.location : path.join(root, e.location) }))
            : fs.readdirSync(root).flatMap(name => {
                const parsed = parseExtensionFolder(name);
                return parsed ? [{ ...parsed, folder: path.join(root, name) }] : [];
            });
        for (const item of folders) {
            const pkgFile = path.join(item.folder, 'package.json');
            if (!exists(pkgFile)) {
                continue;
            }
            try {
                const pkg = readJson(pkgFile) as { publisher?: string; name?: string; version?: string; displayName?: string; enabledApiProposals?: unknown };
                if (usesUnsupportedApi(pkg)) {
                    continue;
                }
                const id = pkg.publisher && pkg.name ? `${pkg.publisher}.${pkg.name}`.toLowerCase() : item.id;
                const displayName = pkg.displayName && !pkg.displayName.startsWith('%') ? pkg.displayName : undefined;
                found.push({ id, version: pkg.version ?? item.version, displayName, folder: item.folder });
            } catch {
                // Unreadable package.json: skip it.
            }
        }
        return latestPerId(found);
    }

    async prepare(extension: DetectedExtension): Promise<PreparedExtension> {
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-import-'));
        const api = openVsxPath(extension.id);
        if (api) {
            try {
                const meta = await this.fetchJson(`${this.openVsx}${api}`) as { files?: { download?: string } };
                const download = meta?.files?.download;
                if (download) {
                    const vsix = path.join(staging, `${extension.id}.vsix`);
                    await this.download(download, vsix);
                    return { id: extension.id, entry: `local-file:${vsix}`, via: 'openvsx' };
                }
            } catch {
                // Not on Open VSX (or offline): fall back to the local copy.
            }
        }
        // Not on Open VSX: copy the folder into Ingot's deployed plugins (scanned on every start), and deploy it now
        // through a staging folder that only links to that copy.
        fs.rmSync(staging, { recursive: true, force: true });
        const deployed = path.join(await this.configDir(), DEPLOYED_PLUGINS_DIR, `${extension.id}-${extension.version}`);
        fs.rmSync(deployed, { recursive: true, force: true });
        fs.cpSync(extension.folder, deployed, { recursive: true, dereference: true });
        const link = fs.mkdtempSync(path.join(await this.configDir(), 'import-staging-'));
        fs.symlinkSync(deployed, path.join(link, path.basename(deployed)), 'dir');
        return { id: extension.id, entry: `local-dir:${link}`, via: 'local' };
    }

    protected async fetchJson(url: string): Promise<unknown> {
        const response = await fetch(url, { signal: AbortSignal.timeout(OPENVSX_TIMEOUT_MS), headers: { accept: 'application/json' } });
        if (!response.ok) {
            throw new Error(`${response.status}`);
        }
        return response.json();
    }

    protected async download(url: string, file: string): Promise<void> {
        const response = await fetch(url, { signal: AbortSignal.timeout(OPENVSX_TIMEOUT_MS * 3) });
        if (!response.ok) {
            throw new Error(`${response.status}`);
        }
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }

    protected async configDir(): Promise<string> {
        const dir = FileUri.fsPath(await this.env.getConfigDirUri());
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    protected async configFile(name: string): Promise<string> {
        return path.join(await this.configDir(), name);
    }

    async importSettings(file: string): Promise<SettingsImportResult> {
        const imported = readJson(file);
        if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
            return { added: 0, skipped: 0 };
        }
        const target = await this.configFile('settings.json');
        const current = exists(target) ? readJson(target) as Record<string, unknown> : {};
        const { merged, added, skipped } = mergeSettings(current ?? {}, imported as Record<string, unknown>);
        if (added) {
            fs.writeFileSync(target, JSON.stringify(merged, undefined, 4));
        }
        return { added, skipped };
    }

    async importKeybindings(file: string): Promise<SettingsImportResult> {
        const imported = readJson(file);
        if (!Array.isArray(imported)) {
            return { added: 0, skipped: 0 };
        }
        const target = await this.configFile('keymaps.json');
        const current = exists(target) ? readJson(target) : [];
        const { merged, added, skipped } = mergeKeybindings(Array.isArray(current) ? current : [], imported);
        if (added) {
            fs.writeFileSync(target, JSON.stringify(merged, undefined, 4));
        }
        return { added, skipped };
    }
}
