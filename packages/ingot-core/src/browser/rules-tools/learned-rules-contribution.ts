import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { LEARNED_PREFS } from '../../common/learned-rules';
import type { LearnedRuleProposal } from '../../common/learned-rules';
import { LEARNED_COMMANDS, LEARNED_TEXT } from '../../common/rules-tools/rules-tools.consts';
import { RulesToolsService } from '../../common/rules-tools/rules-tools.types';
import { AgentStore } from '../agents/agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { LearnedRuleDialog } from './learned-rule-dialog';

/** IDEA-328: opt-in learned rules. Watches hunk rejections and chat corrections; proposals open as a reviewable diff. */
@injectable()
export class LearnedRulesContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(RulesToolsService) protected readonly service: RulesToolsService;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected get enabled(): boolean {
        return this.preferences.get<boolean>(LEARNED_PREFS.enabled, false);
    }

    protected root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    onStart(): void {
        this.tracker.onDidRejectHunks(event => this.watch(root => this.service.learnFromRejection(root, [{
            path: event.path,
            added: event.hunks.flatMap(hunk => hunk.added),
            removed: event.hunks.flatMap(hunk => hunk.removed)
        }])));
        this.agents.onDidSendPrompt(event => this.watch(root => this.service.learnFromMessage(root, event.text)));
    }

    protected watch(learn: (root: string) => Promise<LearnedRuleProposal | undefined>): void {
        const root = this.root();
        if (!this.enabled || !root) {
            return;
        }
        learn(root).then(proposal => proposal && this.announce(proposal)).catch(() => undefined);
    }

    protected async announce(proposal: LearnedRuleProposal): Promise<void> {
        const choice = await this.messages.info(LEARNED_TEXT.drafted(proposal.title), LEARNED_TEXT.review, LEARNED_TEXT.later);
        if (choice === LEARNED_TEXT.review) {
            await this.openReview(proposal.id);
        }
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(LEARNED_COMMANDS.review, { execute: () => this.openReview() });
        registry.registerCommand(LEARNED_COMMANDS.toggle, {
            execute: () => this.setEnabled(!this.enabled),
            isToggled: () => this.enabled
        });
    }

    protected async setEnabled(enabled: boolean): Promise<void> {
        await this.preferences.set(LEARNED_PREFS.enabled, enabled, PreferenceScope.User);
        this.messages.info(enabled ? LEARNED_TEXT.on : LEARNED_TEXT.off);
    }

    async openReview(focusId?: string): Promise<void> {
        const root = this.root();
        if (!root) {
            return;
        }
        if (!this.enabled && !(await this.service.listLearnedRules(root)).length) {
            const choice = await this.messages.info(LEARNED_TEXT.offHint, LEARNED_TEXT.turnOn);
            if (choice === LEARNED_TEXT.turnOn) {
                await this.setEnabled(true);
            }
            return;
        }
        await new LearnedRuleDialog({
            list: () => this.service.listLearnedRules(root),
            accept: (id, body) => this.service.acceptLearnedRule(root, id, body),
            dismiss: id => this.service.dismissLearnedRule(root, id),
            focusId
        }).open();
    }
}
