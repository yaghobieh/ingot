import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import { ElectronMainWindowService } from '@theia/core/lib/electron-common/electron-main-window-service';
import { ElectronMenuContribution } from '@theia/core/lib/electron-browser/menu/electron-menu-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { AgentsWindowOpener } from '../browser/workbench/agents-window';
import { NativeMenuRefresher } from '../browser/workbench/shortcut-conflicts-contribution';

/** In the desktop app the Agents Window (IDEA-118) opens as another app window, not in the system browser. */
@injectable()
export class ElectronAgentsWindowOpener implements AgentsWindowOpener {
    @inject(ElectronMainWindowService) protected readonly mainWindows: ElectronMainWindowService;

    open(url: string): void {
        this.mainWindows.openNewWindow(url, { external: false });
    }
}

/** Theia's menu contribution with a public refresh, so the native menu's accelerators follow keybinding changes (IDEA-122). */
@injectable()
export class IngotElectronMenuContribution extends ElectronMenuContribution implements NativeMenuRefresher {
    refresh(app: FrontendApplication): void {
        this.setMenu(app);
    }
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(ElectronAgentsWindowOpener).toSelf().inSingletonScope();
    rebind(AgentsWindowOpener).toService(ElectronAgentsWindowOpener);
    bind(IngotElectronMenuContribution).toSelf().inSingletonScope();
    rebind(ElectronMenuContribution).toService(IngotElectronMenuContribution);
    bind(NativeMenuRefresher).toService(IngotElectronMenuContribution);
});
