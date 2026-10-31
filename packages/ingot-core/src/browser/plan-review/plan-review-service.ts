import { inject, injectable } from '@theia/core/shared/inversify';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { LearnedHabitStore } from '../habits/learned-store';
import { learnedId } from '../../common/habits/learned.utils';
import type { LearnedHabit } from '../../common/habits/learned.types';
import { classifyTask } from '../../common/router/router.utils';
import type { TaskType } from '../../common/router/router.types';
import type { ApprovedPlan, PlanReview, RunDiff } from '../../common/plan-review/plan-review.types';
import { planFileText, planPath, planTemplate, planTemplatePath, reviewMarkdown, reviewPlan, templateFileText, templatePrompt } from '../../common/plan-review/plan-review.utils';

/**
 * IDEA-306 Plan-Diff Review: the plan the user approved with Build is saved under `.ingot/plans/`; after the run its
 * diff is checked against the steps and the review is appended to the plan. Approved plans teach Habits a plan template
 * per task type, which Plan mode then follows.
 */
@injectable()
export class PlanReviewService {

    @inject(FileService) protected readonly files: FileService;
    @inject(LearnedHabitStore) protected readonly learned: LearnedHabitStore;

    approve(title: string, prompt: string, steps: readonly string[], now = new Date()): ApprovedPlan {
        return { path: planPath(title, now), title, prompt, taskType: classifyTask(prompt), steps, approvedAt: now.toISOString() };
    }

    async save(root: URI, plan: ApprovedPlan): Promise<void> {
        await this.writeFile(root.resolve(plan.path), planFileText(plan));
    }

    /** Compares the run with the plan and appends the review to the plan file. */
    async review(root: URI | undefined, plan: ApprovedPlan, diff: RunDiff): Promise<PlanReview> {
        const review = reviewPlan(plan.path, plan.steps, diff);
        if (root) {
            const uri = root.resolve(plan.path);
            const text = await this.files.read(uri).then(r => r.value, () => planFileText(plan));
            await this.writeFile(uri, `${text}${reviewMarkdown(review, new Date().toISOString())}`).catch(() => undefined);
        }
        return review;
    }

    /** An approved plan is one sample of its task type's template; resolves to the habit when it was just saved. */
    async learnTemplate(root: URI | undefined, plan: ApprovedPlan): Promise<LearnedHabit | undefined> {
        const template = planTemplate(plan.steps);
        if (!template) {
            return undefined;
        }
        const saved = await this.learned.record({ kind: 'plan-template', taskType: plan.taskType, value: template, positive: true });
        if (saved && root && saved.value) {
            const path = planTemplatePath(plan.taskType);
            await this.writeFile(root.resolve(path), templateFileText(plan.taskType, saved.value)).catch(() => undefined);
            await this.learned.markSavedAs(saved.id, path);
            return { ...saved, savedAs: path };
        }
        return saved;
    }

    /** The Plan-mode prompt section for the task type's saved template ('' when none). */
    async templateFor(type: TaskType): Promise<string> {
        const template = await this.learned.value(learnedId('plan-template', type));
        return template ? templatePrompt(type, template) : '';
    }

    protected async writeFile(uri: URI, text: string): Promise<void> {
        if (await this.files.exists(uri)) {
            await this.files.write(uri, text);
        } else {
            await this.files.create(uri, text);
        }
    }
}
