import { inject, injectable } from '@theia/core/shared/inversify';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ZAPREX_OPEN_LINK, ZAPREX_WEB_FALLBACK, type ZaprexDesktopInfo } from '../../common/zaprex/handoff';
import { ZaprexDesktopService } from '../../common/zaprex/zaprex-desktop.types';

const DETECT_TTL_MS = 15_000;

/**
 * IDEA-185: opens Zaprex. With the desktop app installed the T-rex uses the `zaprex://` deep link; otherwise it opens
 * zaprex.dev/app?from=ingot, which offers the download for this OS or "Stay here" (web, where Harmony pieces are off).
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
        const info = await this.info();
        if (info.installed) {
            await this.desktop.open(ZAPREX_OPEN_LINK);
            return;
        }
        this.openWeb();
    }

    openWeb(): void {
        this.windows.openNewWindow(ZAPREX_WEB_FALLBACK, { external: true });
    }
}
