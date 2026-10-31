import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { SandboxPresetService } from './sandbox-preset-service';
import { ReviewModelProvider } from './review-model';
import { AutoReviewer } from './auto-reviewer';
import { SandboxContribution } from './sandbox-contribution';
import { sandboxPreferenceSchema } from './sandbox-preferences';

/** IDEA-288: agent sandbox and approval presets. */
export default new ContainerModule(bind => {
    bind(SandboxPresetService).toSelf().inSingletonScope();
    bind(ReviewModelProvider).toSelf().inSingletonScope();
    bind(AutoReviewer).toSelf().inSingletonScope();
    bind(SandboxContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(SandboxContribution);
    bind(PreferenceContribution).toConstantValue({ schema: sandboxPreferenceSchema });
});
