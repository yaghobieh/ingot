#!/usr/bin/env node
// Dev-only: on macOS the menu bar and Dock read the app name and icon from the Electron.app bundle,
// so `npm run start:electron` shows "Electron". Rename the dev bundle and swap its icon to Ingot.
// Packaged builds get this from electron-builder.yml instead.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'node_modules/electron/dist/Electron.app/Contents';
if (process.platform !== 'darwin' || !existsSync(APP)) {
    process.exit(0);
}
const plistPath = join(APP, 'Info.plist');
const plist = readFileSync(plistPath, 'utf8')
    .replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/, '$1Ingot$2')
    .replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, '$1Ingot$2');
writeFileSync(plistPath, plist);
copyFileSync('assets/brand/app-icon.icns', join(APP, 'Resources', 'electron.icns'));
console.log('brand-electron-dev: dev Electron.app now shows as Ingot');
