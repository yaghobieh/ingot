import {
    ZAPREX_APP_NAME, ZAPREX_LINUX_BIN, ZAPREX_LINUX_DIRS, ZAPREX_MAC_APPLICATIONS, ZAPREX_MAC_BUNDLE, ZAPREX_WINDOWS_EXE
} from './zaprex-launch.consts';
import type { ZaprexLaunchDirs, ZaprexLaunchStep } from './zaprex-launch.types';

const winJoin = (...parts: string[]): string => parts.map(p => p.replace(/[\\/]+$/, '')).join('\\');

/**
 * IDEA-266: how the Rex button starts the real Zaprex desktop app. macOS asks Launch Services (`open -a Zaprex`), then
 * the usual bundle paths; Windows starts the installed exe; Linux the `zaprex` binary or its desktop entry.
 * When every step fails the caller opens the website instead.
 */
export const zaprexLaunchSteps = (dirs: ZaprexLaunchDirs): ZaprexLaunchStep[] => {
    if (dirs.platform === 'mac') {
        const bundles = [`${ZAPREX_MAC_APPLICATIONS}/${ZAPREX_MAC_BUNDLE}`, `${dirs.home}${ZAPREX_MAC_APPLICATIONS}/${ZAPREX_MAC_BUNDLE}`];
        return [
            { cmd: 'open', args: ['-a', ZAPREX_APP_NAME] },
            ...bundles.map(bundle => ({ cmd: 'open', args: [bundle], requires: bundle }))
        ];
    }
    if (dirs.platform === 'windows') {
        const roots = [dirs.localAppData && winJoin(dirs.localAppData, 'Programs', ZAPREX_APP_NAME), dirs.programFiles && winJoin(dirs.programFiles, ZAPREX_APP_NAME)];
        return roots.filter((root): root is string => !!root).map(root => {
            const exe = winJoin(root, ZAPREX_WINDOWS_EXE);
            return { cmd: exe, args: [], requires: exe, detached: true };
        });
    }
    const bins = [`${dirs.home}/.local/bin`, ...ZAPREX_LINUX_DIRS].map(dir => `${dir}/${ZAPREX_LINUX_BIN}`);
    return [
        ...bins.map(bin => ({ cmd: bin, args: [], requires: bin, detached: true })),
        { cmd: 'gtk-launch', args: [ZAPREX_LINUX_BIN] }
    ];
};
