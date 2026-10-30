import { app, nativeTheme, type WebContents } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import type { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import { BROWSER_PARTITION } from '../common/browser-tool/browser-tool.consts';
import { MOCK_KEYCHAIN_SWITCH } from '../common/launch/keychain.consts';
import { needsMockKeychain } from '../common/launch/keychain.utils';
import { launchBackground } from '../common/launch/launch.utils';
import { FORCED_EXIT_AFTER_MS, QUIT_SIGNALS } from '../common/lifecycle/lifecycle.consts';

const WEB_URL = /^(https?:|about:blank)/i;

/**
 * IDEA-130: Ingot's window enables the `<webview>` tag for the agent browser panel. Every webview is locked down:
 * Ingot's own partition, no preload, no Node, sandboxed, http(s) only, and pop-ups open in the same view.
 */
@injectable()
export class IngotElectronMainApplication extends ElectronMainApplication {

    /**
     * No splash window: the main window opens at once as a plain window in the last theme background (restored from
     * the saved window state; the Ingot canvas on first launch) and the workbench fades in when ready. Windows opened
     * later in the session start in the current theme background.
     */
    protected override getDefaultOptions(): TheiaBrowserWindowOptions {
        const options = super.getDefaultOptions();
        return {
            ...options,
            backgroundColor: launchBackground(this.customBackgroundColor, nativeTheme.shouldUseDarkColors),
            webPreferences: { ...options.webPreferences, webviewTag: true }
        };
    }

    override async start(config: Parameters<ElectronMainApplication['start']>[0]): Promise<void> {
        this.mockKeychainForDevLaunches();
        app.on('web-contents-created', (_event, contents) => this.guardWebviews(contents));
        this.quitOnSignals();
        return super.start(config);
    }

    /** Dev and e2e launches keep Chromium off the macOS keychain too, even when started without the switch. */
    protected mockKeychainForDevLaunches(): void {
        if (needsMockKeychain(process.env, name => app.commandLine.hasSwitch(name))) {
            app.commandLine.appendSwitch(MOCK_KEYCHAIN_SWITCH);
        }
    }

    /**
     * IDEA-170: `kill <pid>`, Ctrl+C, a closed terminal or a session logout used to end only the main process and
     * leave the backend running. Quit through Electron instead, so Theia stops the backend (and its process tree).
     * The backend also stops by itself if the main process dies without warning (ParentWatchContribution).
     */
    protected quitOnSignals(): void {
        let quitting = false;
        for (const signal of QUIT_SIGNALS) {
            if (process.platform === 'win32' && signal === 'SIGHUP') {
                continue;
            }
            process.on(signal, () => {
                if (quitting) {
                    return;
                }
                quitting = true;
                console.info(`[ingot] ${signal} received, quitting.`);
                app.quit();
                setTimeout(() => app.exit(0), FORCED_EXIT_AFTER_MS).unref();
            });
        }
    }

    protected guardWebviews(contents: WebContents): void {
        contents.on('will-attach-webview', (event, webPreferences, params) => {
            delete webPreferences.preload;
            webPreferences.nodeIntegration = false;
            webPreferences.nodeIntegrationInSubFrames = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.webSecurity = true;
            if (params.partition !== BROWSER_PARTITION || !WEB_URL.test(params.src ?? '')) {
                event.preventDefault();
            }
        });
        contents.on('did-attach-webview', (_event, page) => {
            page.setWindowOpenHandler(({ url }) => {
                if (WEB_URL.test(url)) {
                    void page.loadURL(url);
                }
                return { action: 'deny' };
            });
            page.on('will-navigate', (event, url) => {
                if (!WEB_URL.test(url)) {
                    event.preventDefault();
                }
            });
        });
    }
}
