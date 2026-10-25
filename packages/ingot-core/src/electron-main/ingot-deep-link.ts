import * as http from 'http';
import * as path from 'path';
import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import { ElectronSecurityToken } from '@theia/core/lib/electron-common/electron-token';
import { DEEP_LINK_BACKEND_PATH } from '../common/account/account.consts';
import { DEEP_LINK_MAX_LENGTH, DEEP_LINK_PREFIX, DEEP_LINK_PROTOCOL } from './deep-link.consts';

const pending: string[] = [];
let backendPort: number | undefined;
/** Theia's per-run Electron token cookie: the backend rejects HTTP requests without it. */
let tokenCookie = '';

const isDeepLink = (value: string): boolean => value.startsWith(DEEP_LINK_PREFIX) && value.length <= DEEP_LINK_MAX_LENGTH;

/** POSTs the link to the local backend (loopback only); the backend validates it and finishes sign-in. */
const forward = (link: string): void => {
    if (backendPort === undefined) {
        pending.push(link);
        return;
    }
    const req = http.request({ host: '127.0.0.1', port: backendPort, path: DEEP_LINK_BACKEND_PATH, method: 'POST', headers: { 'content-type': 'text/plain', cookie: tokenCookie } });
    req.on('error', () => undefined);
    req.end(link);
};

const focusWindow = (): void => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
        if (window.isMinimized()) {
            window.restore();
        }
        window.focus();
    }
};

const receive = (link: string): void => {
    if (isDeepLink(link)) {
        forward(link);
        focusWindow();
    }
};

/**
 * Registered at module load (before app ready) so a cold-start link on macOS is not lost.
 * macOS delivers links via open-url; Windows / Linux pass them in a second instance's argv.
 */
export const registerDeepLinks = (): void => {
    if (process.env.INGOT_NO_PROTOCOL_CLIENT) {
        // Isolated e2e / test launches must not claim the OS-wide ingot:// handler.
    } else if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    }
    app.on('open-url', (event: { preventDefault(): void }, url: string) => {
        event.preventDefault();
        receive(url);
    });
    app.on('second-instance', (_event: unknown, argv: string[]) => argv.filter(isDeepLink).forEach(receive));
    process.argv.filter(isDeepLink).forEach(link => pending.push(link));
};

/** Called once the backend is listening; flushes links that arrived during startup. */
export const setDeepLinkBackend = (port: number, token: ElectronSecurityToken): void => {
    tokenCookie = `${ElectronSecurityToken}=${encodeURIComponent(JSON.stringify(token))}`;
    backendPort = port;
    pending.splice(0).forEach(forward);
};
