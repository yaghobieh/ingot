#!/usr/bin/env node
// Dev-only (IDEA-54, IDEA-108): on macOS the Dock tooltip, menu bar, Cmd-Tab and Activity Monitor read the app name
// from the .app bundle, and Finder/the Dock use the bundle's folder name, so a plain dev run shows "Electron".
// Rename the dev bundle to Ingot.app, give it its own identity and icon, re-sign it ad hoc and register it.
// Packaged builds get all of this from electron-builder.yml instead.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'node_modules/electron/dist';
const PATH_TXT = 'node_modules/electron/path.txt';
const OLD_APP = join(DIST, 'Electron.app');
const APP = join(DIST, 'Ingot.app');
const BUNDLE_ID = 'dev.ingot.preview';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

if (process.platform !== 'darwin') {
    process.exit(0);
}
// Electron 42+ has no install script: the binary is downloaded on first use, so after a clean `npm ci` (CI) there is no
// bundle yet and this used to exit silently, leaving the app as Electron.app (IDEA-189). Download it here first.
if (!existsSync(OLD_APP) && !existsSync(APP) && existsSync('node_modules/electron/install.js')) {
    execFileSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit' });
}
if (!existsSync(OLD_APP) && !existsSync(APP)) {
    console.warn('brand-electron-dev: no Electron.app found; skipping');
    process.exit(0);
}
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
if (existsSync(OLD_APP) && !isLink(OLD_APP)) {
    rmSync(APP, { recursive: true, force: true });
    renameSync(OLD_APP, APP);
}
// Build tools (theia rebuild:electron's ffmpeg step) still look for Electron.app; keep that path as a link.
if (!existsSync(OLD_APP)) {
    rmSync(OLD_APP, { force: true });
    symlinkSync('Ingot.app', OLD_APP);
}
// The electron package finds its binary through path.txt.
writeFileSync(PATH_TXT, 'Ingot.app/Contents/MacOS/Electron');

const contents = join(APP, 'Contents');
const plistPath = join(contents, 'Info.plist');
const setString = (plist, key, value) => {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    return re.test(plist) ? plist.replace(re, `$1${value}$2`) : plist.replace(/<\/dict>\s*<\/plist>\s*$/, `<key>${key}</key><string>${value}</string></dict></plist>\n`);
};
let plist = readFileSync(plistPath, 'utf8');
plist = setString(plist, 'CFBundleName', 'Ingot');
plist = setString(plist, 'CFBundleDisplayName', 'Ingot');
plist = setString(plist, 'CFBundleIdentifier', BUNDLE_ID);
// Register ingot:// (Open in Ingot from the website, IDEA-101) on the dev bundle too.
const URL_TYPES = '<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>dev.ingot.auth</string><key>CFBundleURLSchemes</key><array><string>ingot</string></array></dict></array>';
if (!plist.includes('<string>ingot</string>')) {
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${URL_TYPES}</dict></plist>\n`);
}
writeFileSync(plistPath, plist);
copyFileSync('assets/brand/app-icon.icns', join(contents, 'Resources', 'electron.icns'));

// The edited Info.plist breaks the bundle seal; re-sign ad hoc so macOS keeps launching it.
try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', APP], { stdio: 'ignore' });
} catch {
    console.warn('brand-electron-dev: ad hoc re-sign failed; the dev app may still launch');
}
// Touch and re-register the bundle so Finder, the Dock and Cmd-Tab pick up the new name and icon.
const now = new Date();
utimesSync(APP, now, now);
try {
    execFileSync(LSREGISTER, ['-f', APP], { stdio: 'ignore' });
} catch {
    // Not fatal: Launch Services picks the bundle up on next launch.
}
console.log('brand-electron-dev: dev app is now Ingot.app (dev.ingot.preview)');
