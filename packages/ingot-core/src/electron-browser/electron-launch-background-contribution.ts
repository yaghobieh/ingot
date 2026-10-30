import '@theia/core/lib/electron-common/electron-api';
import { injectable } from '@theia/core/shared/inversify';
import { LaunchBackgroundContribution } from '../browser/theme/launch-background-contribution';

/** The native window keeps the same canvas color; Theia saves it with the window state for the next launch. */
@injectable()
export class ElectronLaunchBackgroundContribution extends LaunchBackgroundContribution {

    protected override applyToWindow(color: string): void {
        window.electronTheiaCore.setBackgroundColor(color);
    }
}
