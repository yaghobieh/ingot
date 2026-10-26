import { inject, injectable } from '@theia/core/shared/inversify';
import { MANIFEST_PATH, OPEN_VSX_API, STORE_PAGE_SIZE, VSIX_CACHE_SIZE, VSIX_ROOT } from '../../common/theme/theme-store.consts';
import type { StoreInstalledTheme, StoreThemeExtension, ThemeSwatch } from '../../common/theme/theme-store.types';
import { parseStoreSearch, storeSearchUrl, swatchOf, themesFromPackage } from '../../common/theme/theme-store.utils';
import { readZipEntries } from '../../common/theme/zip.utils';
import { UserThemeContribution } from './user-theme-contribution';

interface DownloadedPackage {
    readonly themes: StoreInstalledTheme[];
    readonly skipped: string[];
}

/** IDEA-144: color themes from Open VSX - search, download (.vsix), install and uninstall. Runs in the frontend (the API allows CORS). */
@injectable()
export class ThemeStoreService {

    @inject(UserThemeContribution) protected readonly userThemes: UserThemeContribution;

    protected readonly packages = new Map<string, Promise<DownloadedPackage>>();

    async search(query: string, signal?: AbortSignal): Promise<StoreThemeExtension[]> {
        const response = await fetch(storeSearchUrl(OPEN_VSX_API, query, STORE_PAGE_SIZE), { signal });
        if (!response.ok) {
            throw new Error(`Open VSX answered ${response.status}.`);
        }
        return parseStoreSearch(await response.json());
    }

    /** Downloads and reads a package once; later swatch and install calls reuse it. */
    download(extension: StoreThemeExtension): Promise<DownloadedPackage> {
        const key = `${extension.id}@${extension.version}`;
        let pending = this.packages.get(key);
        if (!pending) {
            pending = this.fetchPackage(extension);
            pending.catch(() => this.packages.delete(key));
            this.packages.set(key, pending);
            while (this.packages.size > VSIX_CACHE_SIZE) {
                this.packages.delete(this.packages.keys().next().value as string);
            }
        }
        return pending;
    }

    async swatch(extension: StoreThemeExtension): Promise<ThemeSwatch | undefined> {
        const { themes } = await this.download(extension);
        return themes[0] && swatchOf(themes[0].json, themes[0].uiTheme);
    }

    /** Installs every color theme of the extension; returns them (first one is previewed by the picker). */
    async install(extension: StoreThemeExtension): Promise<StoreInstalledTheme[]> {
        const { themes } = await this.download(extension);
        if (!themes.length) {
            throw new Error(`${extension.displayName} has no color themes Ingot can read.`);
        }
        await this.userThemes.install(themes);
        return themes;
    }

    uninstall(extensionId: string): Promise<string[]> {
        return this.userThemes.uninstall({ extensionId });
    }

    async installedExtensionIds(): Promise<Set<string>> {
        return new Set((await this.userThemes.load()).flatMap(t => t.source ? [t.source.extensionId] : []));
    }

    protected async fetchPackage(extension: StoreThemeExtension): Promise<DownloadedPackage> {
        const response = await fetch(extension.downloadUrl);
        if (!response.ok) {
            throw new Error(`Download failed (${response.status}).`);
        }
        const entries = await readZipEntries(await response.arrayBuffer(), name => name.startsWith(VSIX_ROOT) && /\.jsonc?$/i.test(name));
        const decoder = new TextDecoder();
        const read = (path: string): string | undefined => {
            const bytes = entries.get(path);
            return bytes && decoder.decode(bytes);
        };
        const manifest = read(MANIFEST_PATH);
        if (!manifest) {
            throw new Error('The package has no manifest.');
        }
        return themesFromPackage(JSON.parse(manifest), read, { extensionId: extension.id, version: extension.version, publisher: extension.namespace });
    }
}
