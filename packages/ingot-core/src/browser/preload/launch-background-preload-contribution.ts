import { injectable } from '@theia/core/shared/inversify';
import type { PreloadContribution } from '@theia/core/lib/browser/preload/preloader';
import { LAUNCH_BACKGROUND_KEY, LAUNCH_BACKGROUND_VAR } from '../../common/launch/launch.consts';
import { launchBackground } from '../../common/launch/launch.utils';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Paints the startup overlay in the last theme background before the workbench loads (no logo, no card). */
@injectable()
export class LaunchBackgroundPreloadContribution implements PreloadContribution {

    initialize(): void {
        const dark = !!window.matchMedia?.(DARK_QUERY).matches;
        document.documentElement.style.setProperty(LAUNCH_BACKGROUND_VAR, launchBackground(window.localStorage.getItem(LAUNCH_BACKGROUND_KEY), dark));
    }
}
