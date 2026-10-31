import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { SANDBOX_COMMANDS } from './sandbox.browser-consts';

/** IDEA-288: "Agent Sandbox and Approvals…" opens the composer's preset picker (Find Action, Ingot keymap). */
@injectable()
export class SandboxContribution implements CommandContribution {

    @inject(IngotAgentsContribution) protected readonly agents: IngotAgentsContribution;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SANDBOX_COMMANDS.pick, {
            execute: async () => (await this.agents.openView({ activate: true, reveal: true })).toggleSandboxMenu()
        });
    }
}
