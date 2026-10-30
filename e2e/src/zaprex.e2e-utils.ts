import * as fs from 'fs';
import * as path from 'path';
import { ZAPREX_DETECT_FILE } from './e2e.consts';

/** Pins Zaprex desktop detection, so a Zaprex.app on the developer's machine cannot change the run. */
export const pinZaprexDesktop = (installed: boolean): void => {
    fs.mkdirSync(path.dirname(ZAPREX_DETECT_FILE), { recursive: true });
    fs.writeFileSync(ZAPREX_DETECT_FILE, installed ? 'installed' : 'missing');
};

export const unpinZaprexDesktop = (): void => fs.rmSync(ZAPREX_DETECT_FILE, { force: true });
