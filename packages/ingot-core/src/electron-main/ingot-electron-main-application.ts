import { app, type WebContents } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import type { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import { BROWSER_PARTITION } from '../common/browser-tool/browser-tool.consts';

const WEB_URL = /^(https?:|about:blank)/i;

/**
 * IDEA-130: Ingot's window enables the `<webview>` tag for the agent browser panel. Every webview is locked down:
 * Ingot's own partition, no preload, no Node, sandboxed, http(s) only, and pop-ups open in the same view.
 */
@injectable()
export class IngotElectronMainApplication extends ElectronMainApplication {

    protected override getDefaultOptions(): TheiaBrowserWindowOptions {
        const options = super.getDefaultOptions();
        return { ...options, webPreferences: { ...options.webPreferences, webviewTag: true } };
    }

    override async start(config: Parameters<ElectronMainApplication['start']>[0]): Promise<void> {
        app.on('web-contents-created', (_event, contents) => this.guardWebviews(contents));
        return super.start(config);
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
