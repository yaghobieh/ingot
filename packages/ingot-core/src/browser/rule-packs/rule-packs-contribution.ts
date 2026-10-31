import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager, type EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { parsePackSpec } from '../../common/ingot-kit';
import type { RulePackResult } from '../../common/rule-packs/rule-packs.types';
import { RulePacksModel } from './rule-packs-model';
import { IngotRulePacksWidget } from './rule-packs-widget';
import type { RulePackRemover } from './rule-packs.types';
import { RULE_PACKS_COMMANDS, RULE_PACKS_TEXT, RULE_PACKS_WIDGET_ID, RULE_PACKS_WIDGET_LABEL } from './rule-packs.consts';

/**
 * IDEA-322: the Rule Packs tool window and its commands (Add Rule Pack…, Sync Org Rule Packs, Install / Update / Verify),
 * and read-only editors for files of org-enforced packs.
 */
@injectable()
export class IngotRulePacksContribution extends AbstractViewContribution<IngotRulePacksWidget> implements FrontendApplicationContribution, RulePackRemover {

    @inject(RulePacksModel) protected readonly model: RulePacksModel;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(EditorManager) protected readonly editors: EditorManager;

    constructor() {
        super({ widgetId: RULE_PACKS_WIDGET_ID, widgetName: RULE_PACKS_WIDGET_LABEL, defaultWidgetOptions: { area: 'left', rank: 620 }, toggleCommandId: RULE_PACKS_COMMANDS.toggle.id });
    }

    onStart(): void {
        this.editors.onCreated(widget => this.guard(widget));
        this.model.onDidChange(() => this.editors.all.forEach(widget => this.guard(widget)));
    }

    /** An org-enforced pack file opens read-only. */
    protected guard(widget: EditorWidget): void {
        const editor = MonacoEditor.get(widget);
        if (!editor) {
            return;
        }
        const enforced = this.model.isEnforced(widget.editor.uri);
        editor.getControl().updateOptions({ readOnly: enforced, readOnlyMessage: enforced ? { value: `${widget.editor.uri.path.base} ${RULE_PACKS_TEXT.readOnly}` } : undefined });
        widget.title.caption = enforced ? `${widget.editor.uri.path.base} (${RULE_PACKS_TEXT.enforced})` : widget.title.caption;
    }

    protected report(result: RulePackResult | undefined): void {
        if (!result) {
            this.messages.info(RULE_PACKS_TEXT.noProject);
        } else if (result.ok) {
            this.messages.info(result.message);
        } else {
            this.messages.error(result.message);
        }
    }

    async removePack(key: string): Promise<void> {
        this.report(await this.model.run(root => this.model.service.remove(root, key)));
    }

    protected async addPack(): Promise<void> {
        if (!this.model.root()) {
            this.messages.info(RULE_PACKS_TEXT.noProject);
            return;
        }
        const spec = (await this.quickInput.input({
            prompt: RULE_PACKS_TEXT.addPrompt, placeHolder: RULE_PACKS_TEXT.addPlaceholder,
            validateInput: async value => value.trim() && !parsePackSpec(value) ? RULE_PACKS_TEXT.invalid : undefined
        }))?.trim();
        if (!spec || !parsePackSpec(spec)) {
            return;
        }
        await this.openView({ activate: false, reveal: true });
        this.report(await this.model.run(root => this.model.service.add(root, spec)));
    }

    protected async verify(): Promise<void> {
        await this.openView({ activate: false, reveal: true });
        const issues = await this.model.verify();
        if (!issues.length) {
            this.messages.info(RULE_PACKS_TEXT.verified);
        }
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(RULE_PACKS_COMMANDS.add, { execute: () => this.addPack() });
        registry.registerCommand(RULE_PACKS_COMMANDS.syncOrg, { execute: async () => this.report(await this.model.run(root => this.model.service.syncOrg(root))) });
        registry.registerCommand(RULE_PACKS_COMMANDS.install, { execute: async () => this.report(await this.model.run(root => this.model.service.install(root))) });
        registry.registerCommand(RULE_PACKS_COMMANDS.update, { execute: async () => this.report(await this.model.run(root => this.model.service.update(root))) });
        registry.registerCommand(RULE_PACKS_COMMANDS.verify, { execute: () => this.verify() });
    }
}
