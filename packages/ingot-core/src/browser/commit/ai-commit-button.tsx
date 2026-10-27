import * as React from '@theia/core/shared/react';
import { AI_COMMIT_TEXT } from '../../common/git/ai-commit';
import type { AiCommitRun, AiCommitService } from './ai-commit-service';

/** State of one "Commit with AI" button (docked view or pop-out window); streams into that view's message box. */
export class AiMessageController {
    generating = false;
    error = '';
    protected run: AiCommitRun | undefined;

    constructor(
        protected readonly service: AiCommitService,
        protected readonly getMessage: () => string,
        protected readonly setMessage: (message: string) => void,
        protected readonly update: () => void
    ) { }

    toggle(): void {
        if (this.generating) {
            this.run?.cancel();
            return;
        }
        const previous = this.getMessage();
        this.generating = true;
        this.error = '';
        this.update();
        let streamed = false;
        this.run = this.service.generate(text => {
            streamed = true;
            this.setMessage(text);
            this.update();
        });
        this.run.done.then(text => {
            if (text) {
                this.setMessage(text);
            } else if (!streamed) {
                this.setMessage(previous);
            }
        }).catch((error: Error) => {
            this.error = error.message;
            if (!this.getMessage().trim()) {
                this.setMessage(previous);
            }
        }).finally(() => {
            this.generating = false;
            this.run = undefined;
            this.update();
        });
    }

    dispose(): void {
        this.run?.cancel();
    }
}

export const AiCommitButton = ({ controller, id }: { controller: AiMessageController; id: string }): React.ReactElement => {
    const busy = controller.generating;
    const label = busy ? AI_COMMIT_TEXT.generating : AI_COMMIT_TEXT.button;
    return <button type='button' id={id} className={`ingot-ai-commit${busy ? ' busy' : ''}`} title={label} aria-label={busy ? 'Stop writing the commit message' : 'Commit with AI'}
        aria-busy={busy} onClick={() => controller.toggle()}>
        <span className={`codicon ${busy ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} />
    </button>;
};

export const AiCommitError = ({ controller, id }: { controller: AiMessageController; id: string }): React.ReactElement | null =>
    controller.error ? <div id={id} className='ingot-ai-commit-error' role='alert'><span className='codicon codicon-warning' />{controller.error}</div> : null;
