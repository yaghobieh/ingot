import { inject, injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { IngotAccountBackend } from './ingot-account-backend';
import { DEEP_LINK_BACKEND_PATH } from '../../common/account/account.consts';

const MAX_LINK_LENGTH = 2048;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The desktop main process forwards ingot://auth… links here (macOS open-url / second instance).
 * Loopback only, ingot:// only; the code inside is one-time and short-lived.
 */
@injectable()
export class AccountDeepLinkEndpoint implements BackendApplicationContribution {

    @inject(IngotAccountBackend) protected readonly account: IngotAccountBackend;

    configure(app: Application): void {
        app.post(DEEP_LINK_BACKEND_PATH, (req: Request, res: Response) => {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (chunk: string) => { body += chunk; });
            req.on('end', async () => {
                const url = body.trim();
                if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || req.headers.origin || url.length > MAX_LINK_LENGTH || !url.startsWith('ingot://auth')) {
                    res.status(404).end();
                    return;
                }
                res.status((await this.account.handleDeepLink(url)) ? 204 : 400).end();
            });
        });
    }
}
