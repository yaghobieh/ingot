import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotModelClient } from '../models/model-client';
import {
    TAB_DEFAULT_DEBOUNCE_MS, TAB_DEFAULT_DEV_MODEL, TAB_DEV_CATALOG_MODEL, TAB_FEATURE, TAB_MAX_OUTPUT_TOKENS, TAB_PREFERENCES, TAB_PREFIX_LINES,
    TAB_RECENT_EDITS_MAX, TAB_SUFFIX_LINES, TAB_TEMPERATURE
} from '../../common/tab/tab.consts';
import { recordRecentEdit } from '../../common/tab/tab.utils';
import { runTabPrediction } from '../../common/tab/tab-engine.utils';
import type { TabContext, TabOutcome, TabRecentEdit } from '../../common/tab/tab.types';
import type { ProviderId } from '../../common/models/models.types';
import { IngotTabIgnore } from './tab-ignore';
import { IngotTabNextEdit } from './tab-next-edit';
import { IngotTabUsage } from './tab-usage';
import { TAB_COMMANDS } from './tab.consts';

const NO_ITEMS: monaco.languages.InlineCompletions = { items: [] };

interface TabRoute {
    readonly modelId: string;
    readonly modelOverrides?: Partial<Record<ProviderId, string>>;
}

const wait = (ms: number, token: monaco.CancellationToken): Promise<boolean> => new Promise(resolve => {
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), ms);
    token.onCancellationRequested(() => { clearTimeout(timer); resolve(false); });
});

/**
 * Tab (IDEA-285): debounced fill-in-the-middle ghost text from a cheap fast model through the Ingot gateway
 * (or OpenRouter directly behind a dev setting), with recent edits as context and a next-edit jump hint.
 */
@injectable()
export class IngotTabCompletions implements monaco.languages.InlineCompletionsProvider {

    @inject(IngotModelClient) protected readonly client: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(IngotTabIgnore) protected readonly ignore: IngotTabIgnore;
    @inject(IngotTabUsage) protected readonly usage: IngotTabUsage;
    @inject(IngotTabNextEdit) protected readonly nextEdit: IngotTabNextEdit;

    protected readonly recentEdits = new Map<string, TabRecentEdit[]>();
    lastOutcome?: TabOutcome;

    register(): monaco.IDisposable[] {
        monaco.editor.getModels().forEach(model => this.track(model));
        return [
            monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, this),
            monaco.editor.onDidCreateModel(model => this.track(model)),
            monaco.editor.onWillDisposeModel(model => this.recentEdits.delete(model.uri.toString()))
        ];
    }

    get enabled(): boolean {
        return this.preferences.get<boolean>(TAB_PREFERENCES.enabled, true);
    }

    /** Ingot gateway (or the picked BYOK model); OpenRouter directly when the dev fallback is on and has a key. */
    get route(): TabRoute | undefined {
        if (this.preferences.get<boolean>(TAB_PREFERENCES.devOpenRouter, false) && this.client.isProviderConfigured('openrouter')) {
            const model = this.preferences.get<string>(TAB_PREFERENCES.devOpenRouterModel, TAB_DEFAULT_DEV_MODEL) || TAB_DEFAULT_DEV_MODEL;
            return { modelId: TAB_DEV_CATALOG_MODEL, modelOverrides: { openrouter: model } };
        }
        const modelId = this.client.autocompleteModel;
        return modelId && this.client.isModelConfigured(modelId) ? { modelId } : undefined;
    }

    async provideInlineCompletions(model: monaco.editor.ITextModel, position: monaco.Position, _context: monaco.languages.InlineCompletionContext,
        token: monaco.CancellationToken): Promise<monaco.languages.InlineCompletions> {
        const route = this.route;
        if (!this.enabled || !route || !await wait(this.preferences.get<number>(TAB_PREFERENCES.debounceMs, TAB_DEFAULT_DEBOUNCE_MS), token)) {
            return NO_ITEMS;
        }
        const uri = new URI(model.uri.toString());
        const line = model.getLineContent(position.lineNumber);
        const linePrefix = line.slice(0, position.column - 1);
        const lineSuffix = line.slice(position.column - 1);
        const outcome = await runTabPrediction({
            isIgnored: () => this.ignore.isIgnored(uri),
            buildContext: () => this.buildContext(model, position, uri),
            checkBudget: tokens => this.usage.check(tokens),
            recordRequest: tokens => this.usage.recordRequest(tokens),
            recordReply: tokens => this.usage.recordReply(tokens),
            complete: async messages => (await this.client.complete(route.modelId, [...messages], {
                maxTokens: TAB_MAX_OUTPUT_TOKENS, temperature: TAB_TEMPERATURE, feature: TAB_FEATURE, modelOverrides: route.modelOverrides
            })).text,
            isCancelled: () => token.isCancellationRequested
        }, linePrefix, lineSuffix);
        this.lastOutcome = outcome;
        if (outcome.kind !== 'prediction') {
            return NO_ITEMS;
        }
        const { insertText, replacesSuffix, nextSnippet } = outcome.prediction;
        if (!insertText) {
            if (nextSnippet) {
                this.nextEdit.show(model.uri.toString(), nextSnippet);
            }
            return NO_ITEMS;
        }
        const end = replacesSuffix ? model.getLineMaxColumn(position.lineNumber) : position.column;
        return {
            items: [{
                insertText,
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, end),
                ...(nextSnippet ? { command: { id: TAB_COMMANDS.showNextEdit.id, title: TAB_COMMANDS.jumpToNextEdit.label, arguments: [model.uri.toString(), nextSnippet] } } : {})
            }]
        };
    }

    disposeInlineCompletions(): void {
        // Nothing cached per request.
    }

    protected buildContext(model: monaco.editor.ITextModel, position: monaco.Position, uri: URI): TabContext {
        const last = model.getLineCount();
        const suffixEnd = Math.min(last, position.lineNumber + TAB_SUFFIX_LINES);
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(uri));
        return {
            language: model.getLanguageId(),
            path: root?.resource.relative(uri)?.toString() ?? uri.path.base,
            prefix: model.getValueInRange(new monaco.Range(Math.max(1, position.lineNumber - TAB_PREFIX_LINES), 1, position.lineNumber, position.column)),
            suffix: model.getValueInRange(new monaco.Range(position.lineNumber, position.column, suffixEnd, model.getLineMaxColumn(suffixEnd))),
            recentEdits: this.recentEdits.get(model.uri.toString()) ?? []
        };
    }

    protected track(model: monaco.editor.ITextModel): void {
        model.onDidChangeContent(event => {
            const key = model.uri.toString();
            let edits = this.recentEdits.get(key) ?? [];
            for (const change of event.changes) {
                const line = change.range.startLineNumber;
                if (line <= model.getLineCount()) {
                    edits = recordRecentEdit(edits, { line, text: model.getLineContent(line) }, TAB_RECENT_EDITS_MAX);
                }
            }
            this.recentEdits.set(key, edits);
        });
    }
}
