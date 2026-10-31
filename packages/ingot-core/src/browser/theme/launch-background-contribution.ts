import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { LAUNCH_BACKGROUND_KEY } from '../../common/launch/launch.consts';
import { isLaunchColor } from '../../common/launch/launch.utils';

/**
 * Remembers the workbench canvas color of the current theme, so the next launch opens as a plain window in exactly
 * that color (see LaunchBackgroundPreloadContribution) and fades into the workbench without a color jump.
 */
@injectable()
export class LaunchBackgroundContribution implements FrontendApplicationContribution {

    @inject(ThemeService) protected readonly themes: ThemeService;

    onStart(): void {
        this.themes.onDidColorThemeChange(() => this.rememberSoon());
    }

    onDidInitializeLayout(): void {
        this.rememberSoon();
    }

    /** Theme colors and shell classes settle after the change event; read the canvas on the next frame. */
    protected rememberSoon(): void {
        window.requestAnimationFrame(() => this.remember());
    }

    protected remember(): void {
        const color = window.getComputedStyle(document.body).backgroundColor;
        if (isLaunchColor(color)) {
            window.localStorage.setItem(LAUNCH_BACKGROUND_KEY, color);
            this.applyToWindow(color);
        }
    }

    /** Desktop: also the native window background (electron-browser). */
    protected applyToWindow(_color: string): void { /* browser: nothing to do */ }
}
