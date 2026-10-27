import { inject, injectable } from '@theia/core/shared/inversify';
import { GitService } from '../../common/git/git.types';
import { AI_COMMIT_FEATURE, AI_COMMIT_MAX_TOKENS, AI_COMMIT_TEXT, aiCommitError, cleanCommitMessage, commitMessagePrompt, newFileDiff, truncateDiff } from '../../common/git/ai-commit';
import { IngotAccountService } from '../account/account-service';
import { IngotModelClient } from '../models/model-client';
import { LocalChangesModel } from './local-changes-model';

export interface AiCommitRun {
    /** Resolves with the cleaned message; rejects with a user-facing message. */
    readonly done: Promise<string>;
    cancel(): void;
}

/**
 * IDEA-176 Commit with AI: diff of the staged (included) files, or every change when nothing is staged, truncated,
 * sent to the default Ingot model through the gateway and streamed back as a commit message.
 */
@injectable()
export class AiCommitService {

    @inject(LocalChangesModel) protected readonly model: LocalChangesModel;
    @inject(GitService) protected readonly git: GitService;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;

    /** Picker id of the model used: the server's default Ingot model, else (BYOK on) the first connected one. */
    pickModel(): string | undefined {
        const fallback = this.models.defaultModel;
        if (fallback && this.models.isModelConfigured(fallback)) {
            return fallback;
        }
        const catalog = this.models.catalog;
        return catalog.find(m => m.provider === 'ingot' && this.models.isModelConfigured(m.id))?.id
            ?? catalog.find(m => m.recommended && this.models.isModelConfigured(m.id))?.id
            ?? catalog.find(m => this.models.isModelConfigured(m.id))?.id;
    }

    /** The diff the message is written from (exposed for tests and the "what will be sent" tooltip). */
    async collectDiff(): Promise<string> {
        const root = this.model.root;
        if (!root) {
            return '';
        }
        const included = this.model.included;
        const entries = (included.length ? included : this.model.entries).filter(e => e.status !== 'conflicted');
        const tracked = entries.filter(e => e.status !== 'untracked').flatMap(e => e.oldPath ? [e.path, e.oldPath] : [e.path]);
        let diff = tracked.length ? (await this.git.run(root, { kind: 'diff', paths: tracked }).catch(() => ({ output: '' }))).output : '';
        for (const entry of entries.filter(e => e.status === 'untracked').slice(0, 20)) {
            diff += newFileDiff(entry.path, (await this.model.working(entry.path)).slice(0, 8_000));
        }
        return diff;
    }

    generate(onText: (text: string) => void): AiCommitRun {
        let cancel = (): void => undefined;
        let cancelled = false;
        const done = (async () => {
            const modelId = this.pickModel();
            if (!modelId) {
                throw new Error(this.account.signedIn ? AI_COMMIT_TEXT.noModel : AI_COMMIT_TEXT.signedOut);
            }
            const diff = await this.collectDiff();
            if (!diff.trim()) {
                throw new Error(AI_COMMIT_TEXT.noChanges);
            }
            if (cancelled) {
                return '';
            }
            const run = this.models.stream(modelId, commitMessagePrompt(truncateDiff(diff), this.model.branch), text => onText(cleanCommitMessage(text)),
                { feature: AI_COMMIT_FEATURE, maxTokens: AI_COMMIT_MAX_TOKENS, temperature: 0.2 });
            cancel = run.cancel;
            const text = cleanCommitMessage(await run.done);
            if (!text && !cancelled) {
                throw new Error(AI_COMMIT_TEXT.empty);
            }
            return text;
        })().catch(error => { throw new Error(aiCommitError(error)); });
        return { done, cancel: () => { cancelled = true; cancel(); } };
    }
}
