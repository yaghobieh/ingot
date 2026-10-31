import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import { AbstractViewContribution, QuickInputService, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { PR_HELP, REVIEW_DIAGNOSTIC_SOURCE } from '../../common/code-review/code-review.consts';
import { CodeReviewStore } from './code-review-store';
import { CodeReviewWidget } from './code-review-widget';
import { CODE_REVIEW_COMMANDS, CODE_REVIEW_WIDGET_ID, CODE_REVIEW_WIDGET_LABEL, FIX_ACTION_PREFIX, PR_INPUT_PLACEHOLDER } from './code-review.browser-consts';

const markerCode = (code: monaco.editor.IMarkerData['code']): string | undefined => typeof code === 'string' ? code : code?.value;

/**
 * IDEA-293: "Ingot: Review Changes" and "Ingot: Review GitHub PR" (Find Action, Ingot keymap), the Review panel,
 * and a "Fix with agent" quick fix on every review diagnostic.
 */
@injectable()
export class CodeReviewContribution extends AbstractViewContribution<CodeReviewWidget> implements FrontendApplicationContribution {

    @inject(CodeReviewStore) protected readonly store: CodeReviewStore;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;

    constructor() {
        super({ widgetId: CODE_REVIEW_WIDGET_ID, widgetName: CODE_REVIEW_WIDGET_LABEL, defaultWidgetOptions: { area: 'bottom' }, toggleCommandId: CODE_REVIEW_COMMANDS.toggle.id });
    }

    onStart(): void {
        monaco.languages.registerCodeActionProvider('*', {
            provideCodeActions: (_model, _range, context) => ({
                actions: context.markers.filter(marker => marker.source === REVIEW_DIAGNOSTIC_SOURCE).flatMap(marker => {
                    const finding = this.store.find(markerCode(marker.code) ?? '');
                    return finding ? [{
                        title: `${FIX_ACTION_PREFIX}${finding.title}`, kind: 'quickfix', diagnostics: [marker], isPreferred: true,
                        command: { id: CODE_REVIEW_COMMANDS.fix.id, title: CODE_REVIEW_COMMANDS.fix.label, arguments: [finding.id] }
                    }] : [];
                }),
                dispose: () => undefined
            })
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(CODE_REVIEW_COMMANDS.changes, {
            execute: async () => {
                await this.openView({ activate: false, reveal: true });
                await this.store.reviewLocal();
            },
            isEnabled: () => !this.store.running
        });
        registry.registerCommand(CODE_REVIEW_COMMANDS.githubPr, {
            execute: async (ref?: unknown) => {
                const input = typeof ref === 'string' ? ref : await this.quickInput.input({ prompt: PR_HELP, placeHolder: PR_INPUT_PLACEHOLDER });
                if (!input?.trim()) {
                    return;
                }
                await this.openView({ activate: false, reveal: true });
                await this.store.reviewPullRequest(input);
            },
            isEnabled: () => !this.store.running
        });
        registry.registerCommand(CODE_REVIEW_COMMANDS.fix, {
            execute: (id?: unknown) => typeof id === 'string' ? this.store.fix(id) : undefined
        });
        registry.registerCommand(CODE_REVIEW_COMMANDS.clear, { execute: () => this.store.clear(), isEnabled: () => !!this.store.run && !this.store.running });
    }
}
