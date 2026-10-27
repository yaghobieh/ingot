import * as React from '@theia/core/shared/react';
import { AI_COMMIT_TEXT } from '../../common/git/ai-commit';
import type { AiCommitRun, AiCommitService } from './ai-commit-service';

/** State of one "Commit with AI" button (docked view or pop-out window); streams into that view's message box. */
export class AiMessageController {
    generating = false;
    error = '';
    /** IDEA-183: the message in the box came from Commit with AI (cleared when the box is emptied or after a commit). */
    aiWritten = false;
    protected run: AiCommitRun | undefined;

    constructor(
        protected readonly service: AiCommitService,
        protected readonly getMessage: () => string,
        protected readonly setMessage: (message: string) => void,
        protected readonly update: () => void
    ) {
        this.listener = service.onDidChangeEnabled(() => this.update());
    }

    protected readonly listener: { dispose(): void };

    get enabled(): boolean {
        return this.service.enabled;
    }

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
                this.aiWritten = true;
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

    /** The message to commit (with the "Made with" trailer when the AI wrote it); resets the AI flag. */
    messageToCommit(message: string): string {
        const final = this.service.finalMessage(message, this.aiWritten && !!message.trim());
        return final;
    }

    /** Call when the user empties the box or after a commit. */
    reset(): void {
        this.aiWritten = false;
    }

    dispose(): void {
        this.run?.cancel();
        this.listener.dispose();
    }
}

export const AiCommitButton = ({ controller, id }: { controller: AiMessageController; id: string }): React.ReactElement | null => {
    if (!controller.enabled) {
        return null;
    }
    const busy = controller.generating;
    const label = busy ? AI_COMMIT_TEXT.generating : AI_COMMIT_TEXT.button;
    return <button type='button' id={id} className={`ingot-ai-commit${busy ? ' busy' : ''}`} title={label} aria-label={busy ? 'Stop writing the commit message' : 'Commit with AI'}
        aria-busy={busy} onClick={() => controller.toggle()}>
        <span className={`codicon ${busy ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} />
    </button>;
};

export const AiCommitError = ({ controller, id }: { controller: AiMessageController; id: string }): React.ReactElement | null =>
    controller.error ? <div id={id} className='ingot-ai-commit-error' role='alert'><span className='codicon codicon-warning' />{controller.error}</div> : null;
