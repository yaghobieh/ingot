import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import {
    DOCKER_BIN, DOCKER_BIN_ENV, ENVIRONMENT_BUILD_COMMAND, ENVIRONMENT_COMMAND, ENVIRONMENT_INSTALL_TIMEOUT_MS, TEAM_RULES_DISABLED_PREF
} from '../../common/project-config/project-config.consts';
import {
    dockerBuildCommand, environmentConfigDir, environmentDockerfileLabel, environmentImageTag, resolveEnvironmentBuild
} from '../../common/project-config/environment.utils';
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
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ENVIRONMENT_COMMAND, { execute: () => this.run(), isEnabled: () => !!this.workspace.tryGetRoots()[0] });
        registry.registerCommand(ENVIRONMENT_BUILD_COMMAND, { execute: () => this.buildImage(), isEnabled: () => !!this.workspace.tryGetRoots()[0] });
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
        const notes = [
            environment.build ? `It also describes a container image: run "${ENVIRONMENT_BUILD_COMMAND.label}" to build it locally.` : '',
            environment.snapshot ? `Snapshot ${environment.snapshot} is a Cursor cloud image and is not used locally.` : ''
        ].filter(Boolean).join(' ');
        const done = [environment.install ? 'installed' : '', background.length ? `started ${background.length} process${background.length === 1 ? '' : 'es'}` : ''].filter(Boolean).join(', ');
        this.messages.info(`${source}: ${done || 'nothing to install or start'}.${notes ? ` ${notes}` : ''}`);
    }

    /** IDEA-287: `build` of environment.json as a local Docker image (`docker build`), shown in the Processes list. */
    async buildImage(): Promise<void> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        const cwd = root?.path.fsPath();
        const found = await this.projectConfig.loadEnvironment(root);
        if (!root || !cwd || !found?.environment.build) {
            this.messages.info(`No "build" in ${found?.source ?? 'environment.json'}: add { "build": { "dockerfile": "Dockerfile", "context": ".." } } to build an image.`);
            return;
        }
        const build = resolveEnvironmentBuild(found.environment.build, environmentConfigDir(found.source));
        if (build.dockerfile && !await this.files.exists(root.resolve(build.dockerfile))) {
            this.messages.error(`${found.source}: ${build.dockerfile} does not exist.`);
            return;
        }
        const tag = environmentImageTag(root.path.base);
        const bin = (await this.env.getValue(DOCKER_BIN_ENV).catch(() => undefined))?.value || DOCKER_BIN;
        await this.processes.start({ cwd, command: dockerBuildCommand(bin, build, tag), origin: 'user', background: true });
        this.messages.info(`Building ${tag} from ${environmentDockerfileLabel(build)} (context ${build.context}). Follow it in the Processes list.`);
    }
}
