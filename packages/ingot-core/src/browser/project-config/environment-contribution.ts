import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ENVIRONMENT_COMMAND, ENVIRONMENT_INSTALL_TIMEOUT_MS, TEAM_RULES_DISABLED_PREF } from '../../common/project-config/project-config.consts';
import { ProcessService } from '../../common/processes/processes.types';
import { ProjectConfigService } from './project-config-service';

export const teamRulesPreferenceSchema: PreferenceSchema = {
    properties: {
        [TEAM_RULES_DISABLED_PREF]: {
            type: 'array', items: { type: 'string' }, default: [],
            description: 'Team rules (from your Ingot team) you turned off. Enforced team rules always apply.'
        }
    }
};

/**
 * IDEA-287: "Project Environment: Install and Start" runs `.ingot/environment.json` (or `.cursor/environment.json` while
 * read live): `install` first and waited for, then `start` and each terminal as background processes in the Processes list.
 */
@injectable()
export class EnvironmentContribution implements CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(ProcessService) protected readonly processes: ProcessService;
    @inject(MessageService) protected readonly messages: MessageService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ENVIRONMENT_COMMAND, { execute: () => this.run(), isEnabled: () => !!this.workspace.tryGetRoots()[0] });
    }

    async run(): Promise<void> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        const cwd = root?.path.fsPath();
        const found = await this.projectConfig.loadEnvironment(root);
        if (!cwd || !found) {
            this.messages.info('No environment.json in .ingot (or .cursor) of this project.');
            return;
        }
        const { environment, source } = found;
        environment.errors.forEach(error => this.messages.warn(error));
        if (environment.install) {
            const result = await this.processes.run({ cwd, command: environment.install, origin: 'user', timeoutMs: ENVIRONMENT_INSTALL_TIMEOUT_MS });
            if (result.info.status !== 'exited' || result.info.exitCode !== 0) {
                this.messages.error(`${source}: install failed (${environment.install}). Start and terminals were not run.`);
                return;
            }
        }
        const background = [...(environment.start ? [environment.start] : []), ...environment.terminals.map(t => t.command)];
        await Promise.all(background.map(command => this.processes.start({ cwd, command, origin: 'user', background: true })));
        this.messages.info(`${source}: ${[environment.install ? 'installed' : '', background.length ? `started ${background.length} process${background.length === 1 ? '' : 'es'}` : ''].filter(Boolean).join(', ')}.`);
    }
}
