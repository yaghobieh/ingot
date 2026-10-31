import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { app, Menu, nativeImage, type BrowserWindow } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { parseRecentProjects, RECENT_WORKSPACE_FILE, type RecentProject } from '../common/recent/recent-projects';
/**
 * The @ingot/core resources folder (IDEA-108). In the bundled app the main process runs from
 * applications/electron/lib/backend, so `__dirname/../../resources` is the app's own copy (esbuild.mjs puts it there);
 * the @ingot/core package (tsc output or the monorepo source) is the fallback.
 */
const resourcesDir = (): string => {
    const candidates = [path.resolve(__dirname, '..', '..', 'resources')];
    try {
        candidates.push(path.join(path.dirname(require.resolve('@ingot/core/package.json')), 'resources'));
    } catch {
        // Not resolvable from a bundle; the other candidates cover it.
    }
    candidates.push(path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'ingot-core', 'resources'));
    return candidates.find(dir => fs.existsSync(path.join(dir, 'app-icon.png'))) ?? candidates[0];
};
const RESOURCES_DIR = resourcesDir();
/** Packaged with @ingot/core so dev runs and builds both show the Ingot icon. */
export const APP_ICON_PATH = path.join(RESOURCES_DIR, 'app-icon.png');
/** Launch animation frames of the </> mark (scripts/build-icon-v3.mjs). */
export const DOCK_ANIMATION_DIR = path.join(RESOURCES_DIR, 'dock-anim');
const DOCK_FRAME_MS = 50;

/** macOS "Reduce motion" (System Settings › Accessibility › Display). */
const prefersReducedMotion = (): Promise<boolean> => new Promise(resolve => {
    execFile('defaults', ['read', 'com.apple.universalaccess', 'reduceMotion'], { timeout: 1000 }, (error, stdout) => resolve(!error && stdout.trim() === '1'));
});

/** Desktop branding: Ingot name and icon in the Dock / taskbar / windows (IDEA-54). */
@injectable()
export class IngotElectronMainContribution implements ElectronMainApplicationContribution {

    protected application: ElectronMainApplication | undefined;
    protected lastRecent = '';

    onStart(application?: ElectronMainApplication): void {
        this.application = application;
        this.installRecentMenus();
        const icon = nativeImage.createFromPath(APP_ICON_PATH);
        if (icon.isEmpty()) {
            return;
        }
        if (process.platform === 'darwin') {
            app.dock?.setIcon(icon);
            this.animateDock(icon);
        } else {
            app.on('browser-window-created', (_event: unknown, window: BrowserWindow) => window.setIcon(icon));
        }
    }

    /** Plays the </> mark animation in the Dock once on launch (~1.5 s), then settles on the static icon. */
    protected async animateDock(finalIcon: Electron.NativeImage): Promise<void> {
        if (process.env.INGOT_NO_DOCK_ANIMATION || await prefersReducedMotion()) {
            return;
        }
        const frames = fs.existsSync(DOCK_ANIMATION_DIR)
            ? fs.readdirSync(DOCK_ANIMATION_DIR).filter(f => f.endsWith('.png')).sort().map(f => nativeImage.createFromPath(path.join(DOCK_ANIMATION_DIR, f))).filter(i => !i.isEmpty())
            : [];
        for (const frame of frames) {
            app.dock?.setIcon(frame);
            await new Promise(resolve => setTimeout(resolve, DOCK_FRAME_MS));
        }
        app.dock?.setIcon(finalIcon);
    }

    /** The config dir holding recentworkspace.json (the app package.json configurationFolder). */
    protected recentFile(): string {
        return path.join(process.env.THEIA_CONFIG_DIR ?? path.join(os.homedir(), '.ingot'), RECENT_WORKSPACE_FILE);
    }

    protected readRecent(): RecentProject[] {
        try {
            return parseRecentProjects(fs.readFileSync(this.recentFile(), 'utf8'));
        } catch {
            return [];
        }
    }

    /** Dock menu (macOS) / jump list (Windows): New Window + recent projects (IDEA-75); refreshed when recents change. */
    protected installRecentMenus(): void {
        if (process.platform !== 'darwin' && process.platform !== 'win32') {
            return;
        }
        const refresh = () => this.updateRecentMenus(this.readRecent());
        app.whenReady().then(refresh);
        fs.watchFile(this.recentFile(), { interval: 2000 }, refresh);
        app.on('will-quit', () => fs.unwatchFile(this.recentFile()));
    }

    protected updateRecentMenus(recent: RecentProject[]): void {
        const key = JSON.stringify(recent);
        if (key === this.lastRecent) {
            return;
        }
        this.lastRecent = key;
        if (process.platform === 'darwin') {
            app.dock?.setMenu(Menu.buildFromTemplate([
                { label: 'New Window', click: () => this.newWindow() },
                ...(recent.length ? [
                    { type: 'separator' as const },
                    { label: 'Recent', enabled: false },
                    ...recent.map(r => ({ label: r.label, toolTip: r.path, click: () => this.openRecent(r.path) }))
                ] : [])
            ]));
            for (const r of [...recent].reverse()) {
                app.addRecentDocument(r.path);
            }
        } else {
            const exe = process.execPath;
            const appArgs = process.defaultApp && process.argv[1] ? [JSON.stringify(path.resolve(process.argv[1]))] : [];
            const args = (...extra: string[]) => [...appArgs, ...extra].join(' ');
            app.setUserTasks([{ program: exe, arguments: args('--new-window'), iconPath: exe, iconIndex: 0, title: 'New Window', description: 'Open a new Ingot window' }]);
            try {
                app.setJumpList([
                    { type: 'tasks', items: [{ type: 'task', title: 'New Window', program: exe, args: args('--new-window'), iconPath: exe, iconIndex: 0, description: 'Open a new Ingot window' }] },
                    ...(recent.length ? [{
                        type: 'custom' as const, name: 'Recent',
                        items: recent.map(r => ({ type: 'task' as const, title: r.label, description: r.path, program: exe, args: args(JSON.stringify(r.path)), iconPath: exe, iconIndex: 0 }))
                    }] : [])
                ]);
            } catch {
                // Jump lists can be disabled by policy; the user tasks above still work.
            }
        }
    }

    protected newWindow(): void {
        this.application?.openDefaultWindow();
    }

    protected openRecent(fsPath: string): void {
        if (!fs.existsSync(fsPath)) {
            return;
        }
        // Protected in core, but it is the same path core uses for `ingot <folder>` from a second instance.
        (this.application as unknown as { openWindowWithWorkspace(p: string): Promise<unknown> } | undefined)?.openWindowWithWorkspace(fsPath);
    }
}
