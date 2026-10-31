import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { type PreferenceSchema, PreferenceService } from '@theia/core/lib/common/preferences';
import { BUGBOT_AUTO_POST_PREF, BUGBOT_POST_COMMAND, BUGBOT_SLASH, BUGBOT_TEXT, NO_CHANGES_TEXT, SEVERITY_LABELS, REVIEW_SEVERITIES } from '../../common/code-review/code-review.consts';
import type { BugbotRequest } from '../../common/code-review/code-review.types';
import { parseBugbotPrompt, severityCounts } from '../../common/code-review/code-review.utils';
import type { AgentSession } from '../../common/agents/agents.types';
import { AgentStore } from '../agents/agent-store';
import { CodeReviewContribution } from './code-review-contribution';
import { CodeReviewStore, type ReviewRun } from './code-review-store';

export const bugbotPreferenceSchema: PreferenceSchema = {
    properties: {
        [BUGBOT_AUTO_POST_PREF]: {
            type: 'boolean', default: false,
            description: 'After "/bugbot #12" reviews a GitHub pull request, post the findings as a comment on it (GitHub CLI or GH_TOKEN). Off: use "Post to GitHub PR" in the Review panel.'
        }
    }
};

/**
 * IDEA-287: `/bugbot` in the chat. With a pull request (`/bugbot #12`, `/bugbot pr 12`, a PR URL) it runs the AI review
 * on the PR with the BUGBOT.md guidelines and can post the findings to GitHub. Without one it reviews the local changes,
 * unless the project's BUGBOT.md `/bugbot` command handles that in the chat.
 */
@injectable()
export class BugbotContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(CodeReviewStore) protected readonly store: CodeReviewStore;
    @inject(CodeReviewContribution) protected readonly view: CodeReviewContribution;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(MessageService) protected readonly messages: MessageService;

    onStart(): void {
        this.agents.registerCommandHandler((session, prompt) => this.handle(session, prompt));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(BUGBOT_POST_COMMAND, {
            execute: () => this.post(),
            isEnabled: () => this.store.run?.status === 'done' && !!this.store.run.pullRequest && !this.store.run.posting
        });
    }

    protected handle(session: AgentSession, prompt: string): boolean {
        const request = parseBugbotPrompt(prompt);
        if (!request || (request.kind !== 'pr' && this.agents.projectCommands.some(command => command.name === BUGBOT_SLASH))) {
            return false;
        }
        void this.run(session, request);
        return true;
    }

    protected async run(session: AgentSession, request: BugbotRequest): Promise<void> {
        if (this.store.running) {
            this.reply(session, BUGBOT_TEXT.busy);
            return;
        }
        const target = request.kind === 'pr' ? `pull request ${request.ref}` : 'the local changes';
        this.reply(session, `${BUGBOT_TEXT.started} ${target}… ${BUGBOT_TEXT.panel}`);
        await this.view.openView({ activate: false, reveal: true });
        const run = request.kind === 'pr' ? await this.store.reviewPullRequest(request.ref) : await this.store.reviewLocal();
        if (!run || run.status !== 'done' || run.message === NO_CHANGES_TEXT) {
            this.reply(session, run?.message ?? BUGBOT_TEXT.busy);
            return;
        }
        let text = this.summary(run);
        if (run.pullRequest) {
            if (this.preferences.get<boolean>(BUGBOT_AUTO_POST_PREF, false)) {
                const posted = await this.store.postToPullRequest();
                text += posted.ok ? ` ${BUGBOT_TEXT.posted}${posted.url ? `: ${posted.url}` : '.'}` : ` ${posted.error ?? ''}`;
            } else {
                text += ` ${BUGBOT_TEXT.postHint}`;
            }
        }
        this.reply(session, text);
    }

    protected summary(run: ReviewRun): string {
        const counts = severityCounts(run.findings);
        if (!run.findings.length) {
            return `Bugbot found no problems in ${run.label} (${run.reviewedFiles.length} file${run.reviewedFiles.length === 1 ? '' : 's'}).`;
        }
        const bySeverity = REVIEW_SEVERITIES.filter(severity => counts[severity]).map(severity => `${counts[severity]} ${SEVERITY_LABELS[severity].toLowerCase()}`).join(', ');
        return `Bugbot found ${run.findings.length} issue${run.findings.length === 1 ? '' : 's'} in ${run.label} (${bySeverity}). ${BUGBOT_TEXT.panel}`;
    }

    protected async post(): Promise<void> {
        const result = await this.store.postToPullRequest();
        if (result.ok) {
            this.messages.info(`${BUGBOT_TEXT.posted}${result.url ? `: ${result.url}` : '.'}`);
        } else {
            this.messages.error(result.error ?? BUGBOT_TEXT.noPullRequest);
        }
    }

    protected reply(session: AgentSession, text: string): void {
        session.messages.push({ role: 'agent', text });
        session.status = 'idle';
        session.updatedAt = Date.now();
        this.agents.changed();
    }
}
