import { ContainerModule } from '@theia/core/shared/inversify';
import { PreloadContribution } from '@theia/core/lib/browser/preload/preloader';
import { LaunchBackgroundPreloadContribution } from './launch-background-preload-contribution';

export default new ContainerModule(bind => {
    bind(LaunchBackgroundPreloadContribution).toSelf().inSingletonScope();
    bind(PreloadContribution).toService(LaunchBackgroundPreloadContribution);
});
