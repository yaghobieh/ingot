import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { IngotModelClient } from './model-client';
import { AUTOCOMPLETE_SYSTEM_PROMPT, MODEL_PREFERENCES } from '../../common/models/models.consts';
import { buildCompletionMessages, cleanCompletion } from '../../common/models/models.utils';

const PREFIX_LINES = 80;
const SUFFIX_LINES = 30;
const MAX_TOKENS = 128;

const wait = (ms: number, token: monaco.CancellationToken): Promise<boolean> => new Promise(resolve => {
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), ms);
    token.onCancellationRequested(() => { clearTimeout(timer); resolve(false); });
});

/** Ghost-text completions from the user's own model (IDEA-25). Tab accepts, Ctrl/⌘+→ accepts word by word. */
@injectable()
export class IngotInlineCompletions implements monaco.languages.InlineCompletionsProvider {

    @inject(IngotModelClient) protected readonly client: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    lastError?: string;

    register(): monaco.IDisposable {
        return monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, this);
    }

    get enabled(): boolean {
        return this.preferences.get<boolean>(MODEL_PREFERENCES.autocompleteEnabled, true);
    }

    async provideInlineCompletions(model: monaco.editor.ITextModel, position: monaco.Position, _context: monaco.languages.InlineCompletionContext,
        token: monaco.CancellationToken): Promise<monaco.languages.InlineCompletions> {
        const modelId = this.client.autocompleteModel;
        if (!this.enabled || !modelId || !this.client.isModelConfigured(modelId)) {
            return { items: [] };
        }
        if (!await wait(this.preferences.get<number>(MODEL_PREFERENCES.autocompleteDebounce, 300), token)) {
            return { items: [] };
        }
        const prefix = model.getValueInRange(new monaco.Range(Math.max(1, position.lineNumber - PREFIX_LINES), 1, position.lineNumber, position.column));
        const lastLine = model.getLineCount();
        const suffix = model.getValueInRange(new monaco.Range(position.lineNumber, position.column, Math.min(lastLine, position.lineNumber + SUFFIX_LINES), model.getLineMaxColumn(Math.min(lastLine, position.lineNumber + SUFFIX_LINES))));
        try {
            const result = await this.client.complete(modelId, buildCompletionMessages(prefix, suffix, model.getLanguageId(), AUTOCOMPLETE_SYSTEM_PROMPT), { maxTokens: MAX_TOKENS, temperature: 0 });
            this.lastError = undefined;
            if (token.isCancellationRequested) {
                return { items: [] };
            }
            const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
            const text = cleanCompletion(result.text, linePrefix);
            return text.trim() ? { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] } : { items: [] };
        } catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            return { items: [] };
        }
    }

    disposeInlineCompletions(): void {
        // Nothing cached per request.
    }
}
