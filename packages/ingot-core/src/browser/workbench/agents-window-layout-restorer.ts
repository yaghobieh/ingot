import { injectable } from '@theia/core/shared/inversify';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { isAgentsWindow } from './agents-window';

/** The Agents Window (IDEA-118) starts from the default layout and never overwrites the main window's saved layout. */
@injectable()
export class IngotShellLayoutRestorer extends ShellLayoutRestorer {

    override storeLayout(app: FrontendApplication): void {
        if (!isAgentsWindow()) {
            super.storeLayout(app);
        }
    }

    override async restoreLayout(app: FrontendApplication): Promise<boolean> {
        return isAgentsWindow() ? false : super.restoreLayout(app);
    }
}
