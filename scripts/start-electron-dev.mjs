#!/usr/bin/env node
// Dev launch of the desktop app (`npm run start:electron`) that never touches the macOS keychain: secrets go to a
// file key store in the temp folder (INGOT_DEV_FILE_KEYSTORE, unless already set) and Chromium gets
// --use-mock-keychain, so no "Electron Helper wants to use your keychain" prompt after a rebuild.
// Run from applications/electron; extra arguments go to `theia start`.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEYSTORE_ENV = 'INGOT_DEV_FILE_KEYSTORE';
const MOCK_KEYCHAIN_ARG = '--use-mock-keychain';
const KEYSTORE_FILE = join(tmpdir(), 'ingot-dev', 'keystore.json');

const env = { ...process.env, [KEYSTORE_ENV]: process.env[KEYSTORE_ENV] || KEYSTORE_FILE };
const args = process.argv.slice(2);
const theiaArgs = ['start', ...args, ...(args.includes(MOCK_KEYCHAIN_ARG) ? [] : [MOCK_KEYCHAIN_ARG])];

const child = spawn('theia', theiaArgs, { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}
