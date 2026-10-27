import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { fixWithAgentPrompt, type HookStage } from '../../common/git/hooks';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { AgentStore } from '../agents/agent-store';
import { AgentHooksService, type HooksRun } from './agent-hooks-service';
import { HooksDialog } from './hooks-dialog';
import { HOOKS_COMMANDS, type HooksGateResult } from './hooks.consts';

/**
 * IDEA-178: the gate Ingot's commit and push go through. Runs the stage's `.ingot/hooks.json` steps; a failure
 * blocks and opens the results (tool cards) with Fix with agent or Bypass.
 */
@injectable()
export class AgentHooksGate implements CommandContribution {

    @inject(AgentHooksService) protected readonly hooks: AgentHooksService;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    /** `passed` / `off`: go ahead (git's own Ingot hook is skipped, the steps already ran). `bypassed`: go ahead once. `blocked`: stop. */
    async gate(root: string, stage: HookStage, diff?: () => Promise<string>): Promise<HooksGateResult> {
        if (!this.hooks.enabled) {
            return 'off';
        }
        const run = await this.hooks.run(root, stage, diff);
        if (run.passed) {
            if (run.results.length) {
                this.messages.info(`.ingot hooks: ${stage} passed (${run.results.length} step${run.results.length === 1 ? '' : 's'}).`);
            }
            return 'passed';
        }
        const choice = await new HooksDialog({ run, action: stage === 'pre-push' ? 'push' : 'commit', openLink: url => this.windows.openNewWindow(url, { external: true }) }).open();
        if (choice === 'bypass') {
            return 'bypassed';
        }
        if (choice === 'fix') {
            await this.fixWithAgent(run);
        }
        return 'blocked';
    }

    async fixWithAgent(run: HooksRun | undefined = this.hooks.lastRun): Promise<void> {
        if (!run) {
            return;
        }
        await this.commands.executeCommand(AGENT_COMMANDS.newAgent.id);
        this.store.send(fixWithAgentPrompt(run.stage, run.results.filter(r => r.state === 'failed')));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(HOOKS_COMMANDS.createTemplate, {
            execute: async () => {
                const uri = await this.hooks.createTemplate();
                if (!uri) {
                    this.messages.info('Open a project first.');
                    return;
                }
                await open(this.opener, uri);
            }
        });
        registry.registerCommand(HOOKS_COMMANDS.installGitHooks, {
            execute: async () => {
                const { installed, skipped } = await this.hooks.installGitHooks();
                const text = installed.length ? `Installed the ${installed.join(' and ')} git hook${installed.length === 1 ? '' : 's'}.` : 'No Ingot git hooks to install (add steps to .ingot/hooks.json, or turn the setting on).';
                this.messages.info([text, ...skipped].join(' '));
            }
        });
        registry.registerCommand(HOOKS_COMMANDS.runPreCommit, {
            execute: async () => {
                const root = this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
                if (root) {
                    const result = await this.gate(root, 'pre-commit');
                    if (result === 'off') {
                        this.messages.info('Agent git hooks are off (Settings › AI & Zaprex).');
                    }
                }
            }
        });
        registry.registerCommand(HOOKS_COMMANDS.fixWithAgent, { execute: () => this.fixWithAgent(), isEnabled: () => !!this.hooks.lastRun && !this.hooks.lastRun.passed });
    }
}
