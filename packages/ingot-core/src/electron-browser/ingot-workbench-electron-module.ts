import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import { ElectronMainWindowService } from '@theia/core/lib/electron-common/electron-main-window-service';
import { AgentsWindowOpener } from '../browser/workbench/agents-window';

/** In the desktop app the Agents Window (IDEA-118) opens as another app window, not in the system browser. */
@injectable()
export class ElectronAgentsWindowOpener implements AgentsWindowOpener {
    @inject(ElectronMainWindowService) protected readonly mainWindows: ElectronMainWindowService;

    open(url: string): void {
        this.mainWindows.openNewWindow(url, { external: false });
    }
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(ElectronAgentsWindowOpener).toSelf().inSingletonScope();
    rebind(AgentsWindowOpener).toService(ElectronAgentsWindowOpener);
});
