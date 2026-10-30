import { injectable } from '@theia/core/shared/inversify';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { isAgentsWindow } from './agents-window';
import { LAYOUT_SAVE_DEBOUNCE_MS } from './panels.consts';

/** The Agents Window (IDEA-118) starts from the default layout and never overwrites the main window's saved layout. */
@injectable()
export class IngotShellLayoutRestorer extends ShellLayoutRestorer {

    /** IDEA-281: true when this window started from a saved layout; the shell then keeps what the user had open. */
    restored = false;
    protected watching = false;

    override storeLayout(app: FrontendApplication): void {
        if (!isAgentsWindow()) {
            super.storeLayout(app);
        }
    }

    override async restoreLayout(app: FrontendApplication): Promise<boolean> {
        this.restored = isAgentsWindow() ? false : await super.restoreLayout(app);
        return this.restored;
    }

    /**
     * Theia saves the layout only on a clean unload, so a crash, a rebuild or an update restart lost open editors and
     * panels. Save shortly after every change instead, and when the window is hidden.
     */
    keepStored(app: FrontendApplication): void {
        if (this.watching || isAgentsWindow()) {
            return;
        }
        this.watching = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = (): void => {
            clearTimeout(timer);
            timer = undefined;
            this.storeLayout(app);
        };
        const save = (): void => {
            clearTimeout(timer);
            timer = setTimeout(flush, LAYOUT_SAVE_DEBOUNCE_MS);
        };
        const shell = app.shell;
        shell.onDidAddWidget(save);
        shell.onDidRemoveWidget(save);
        shell.onDidChangeActiveWidget(save);
        shell.onDidChangeCurrentWidget(save);
        for (const panel of [shell.mainPanel, shell.bottomPanel, shell.leftPanelHandler.dockPanel, shell.rightPanelHandler.dockPanel]) {
            panel.layoutModified.connect(save);
        }
        for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
            handler.tabBar.currentChanged.connect(save);
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flush();
            }
        });
    }
}
