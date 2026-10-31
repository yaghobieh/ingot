import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { TEAM_RULES_COMMAND, TEAM_RULES_SETTINGS_PAGE } from '../../common/team-rules/team-rules-admin.consts';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';
import { TeamRulesAdminService } from './team-rules-admin-service';

/** IDEA-287: "Team Rules: Edit for the Team (Admin)…" opens Settings › Team Rules; only admins see it. */
@injectable()
export class TeamRulesContribution implements CommandContribution {

    @inject(TeamRulesAdminService) protected readonly service: TeamRulesAdminService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(TEAM_RULES_COMMAND, {
            execute: () => registry.executeCommand(SETTINGS_OPEN_COMMAND.id, TEAM_RULES_SETTINGS_PAGE),
            isEnabled: () => this.service.isAdmin,
            isVisible: () => this.service.isAdmin
        });
    }
}
