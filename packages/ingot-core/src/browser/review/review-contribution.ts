import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonMenus, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AgentStore } from '../agents/agent-store';
import { REVIEW_SUBMIT_COMMAND, REVIEW_TOGGLE_COMMAND } from '../../common/review/review';
import { ReviewComments } from './review-comments';

/** IDEA-105: Toggle Agent Review (gear / Manage menu, palette) and Finish Review. */
@injectable()
export class ReviewContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ReviewComments) protected readonly comments: ReviewComments;

    onStart(): void {
        // Instantiates the comment layer so editors opened from now on get the + gutter.
        void this.comments.comments;
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(REVIEW_TOGGLE_COMMAND, {
            execute: () => this.store.setReviewEnabled(!this.store.review.enabled),
            isToggled: () => this.store.review.enabled
        });
        registry.registerCommand(REVIEW_SUBMIT_COMMAND, {
            execute: () => {
                const id = this.store.current?.id;
                return id ? this.comments.submit(id) : false;
            },
            isEnabled: () => !!this.store.current && this.comments.drafts(this.store.current.id).length > 0
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.MANAGE_GENERAL, { commandId: REVIEW_TOGGLE_COMMAND.id, label: 'Agent Review', order: 'b2' });
    }
}
