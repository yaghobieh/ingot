import { inject, injectable } from '@theia/core/shared/inversify';
import { ElectronSecurityToken } from '@theia/core/lib/electron-common/electron-token';
import type { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { registerDeepLinks, setDeepLinkBackend } from './ingot-deep-link';

// Before app ready, so a cold-start ingot:// link on macOS is not lost.
registerDeepLinks();

/** Forwards ingot://auth links (Open in Ingot) to the local backend once it listens (IDEA-101). */
@injectable()
export class IngotDeepLinkContribution implements ElectronMainApplicationContribution {

    @inject(ElectronSecurityToken) protected readonly securityToken: ElectronSecurityToken;

    onStart(application?: ElectronMainApplication): void {
        application?.backendPort.then(port => setDeepLinkBackend(port, this.securityToken), () => undefined);
    }
}
