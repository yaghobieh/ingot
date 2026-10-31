import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { NO_PROJECT_MESSAGE, RULES_TOOLS_COMMANDS } from '../../common/rules-tools/rules-tools.consts';
import { RulesToolsService } from '../../common/rules-tools/rules-tools.types';
import { RulesExportDialog } from './rules-export-dialog';
import { RulesTestDialog } from './rules-test-dialog';

/** Commands behind the Rules tab's Export / Test / Prune buttons (also in Find Action under "Rules"). */
@injectable()
export class RulesToolsContribution implements CommandContribution {

    @inject(RulesToolsService) protected readonly service: RulesToolsService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;

    protected root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(RULES_TOOLS_COMMANDS.export, { execute: () => this.openExport() });
        registry.registerCommand(RULES_TOOLS_COMMANDS.test, { execute: () => this.openTest() });
    }

    async openExport(): Promise<void> {
        const root = this.root();
        if (!root) {
            this.messages.info(NO_PROJECT_MESSAGE);
            return;
        }
        const exported = await new RulesExportDialog({
            plan: (targets, force) => this.service.planExport(root, targets, force),
            apply: (targets, force) => this.service.applyExport(root, targets, force)
        }).open();
        if (exported) {
            this.messages.info('Rules exported to the other tools\' files.');
        }
    }

    async openTest(): Promise<void> {
        const root = this.root();
        if (!root) {
            this.messages.info(NO_PROJECT_MESSAGE);
            return;
        }
        await new RulesTestDialog({
            list: () => this.service.listRuleTests(root),
            run: request => this.service.runRuleTests(root, request)
        }).open();
    }
}
