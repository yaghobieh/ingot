import { inject, injectable } from '@theia/core/shared/inversify';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ZAPREX_WEB_FALLBACK, type ZaprexDesktopInfo } from '../../common/zaprex/handoff';
import { ZaprexDesktopService } from '../../common/zaprex/zaprex-desktop.types';

const DETECT_TTL_MS = 15_000;

/**
 * IDEA-185 / IDEA-266: opens Zaprex. The Rex button starts the real desktop app (`open -a Zaprex` on macOS, the installed
 * exe / binary elsewhere); without it, it opens zaprex.dev/app?from=ingot, which offers the download for this OS.
 */
@injectable()
export class ZaprexLauncher {
    @inject(ZaprexDesktopService) protected readonly desktop: ZaprexDesktopService;
    @inject(WindowService) protected readonly windows: WindowService;

    protected last?: { at: number; info: ZaprexDesktopInfo };

    /** Last known answer (undefined until the first check). */
    get installed(): boolean | undefined {
        return this.last?.info.installed;
    }

    async info(): Promise<ZaprexDesktopInfo> {
        if (this.last && Date.now() - this.last.at < DETECT_TTL_MS) {
            return this.last.info;
        }
        const info = await this.desktop.detect().catch((): ZaprexDesktopInfo => ({ installed: false, platform: 'linux' }));
        this.last = { at: Date.now(), info };
        return info;
    }

    async openApp(): Promise<void> {
        const launched = await this.desktop.launch().catch(() => false);
        if (!launched) {
            this.openWeb();
        }
    }

    openWeb(): void {
        this.windows.openNewWindow(ZAPREX_WEB_FALLBACK, { external: true });
    }
}
