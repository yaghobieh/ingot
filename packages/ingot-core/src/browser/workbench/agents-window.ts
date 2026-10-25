import { inject, injectable } from '@theia/core/shared/inversify';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { agentsWindowUrl, isAgentsWindowUrl } from '../../common/workbench/agents-window.utils';

/** Opens a window; Electron rebinds this so the window opens inside the app instead of the system browser. */
export const AgentsWindowOpener = Symbol('AgentsWindowOpener');
export interface AgentsWindowOpener {
    open(url: string): void;
}

@injectable()
export class BrowserAgentsWindowOpener implements AgentsWindowOpener {
    @inject(WindowService) protected readonly windows: WindowService;

    open(url: string): void {
        this.windows.openNewWindow(url, { external: false });
    }
}

/** This window is the dedicated Agents Window. */
export const isAgentsWindow = (): boolean => typeof window !== 'undefined' && isAgentsWindowUrl(window.location.search);
export const currentAgentsWindowUrl = (): string => agentsWindowUrl(window.location.href);
