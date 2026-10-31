import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { describePolicy, formatUsd } from '../../common/ingot-kit';
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import { IngotPolicyService } from './ingot-policy-service';
import { IngotPolicyWidget } from './policy-widget';
import { INGOT_POLICY_COMMANDS, POLICY_STATUS_ID, POLICY_TEXT, POLICY_WIDGET_ID, POLICY_WIDGET_LABEL } from './ingot-policy.consts';

const STATUS_PRIORITY = 960;
const STATUS_SEPARATOR = ' · ';

/** IDEA-325 / IDEA-326: the Policy tool window, Create Policy, Create Folder Policy… and the status bar item for the current file's policy. */
@injectable()
export class IngotPolicyContribution extends AbstractViewContribution<IngotPolicyWidget> implements FrontendApplicationContribution {

    @inject(IngotPolicyService) protected readonly policies: IngotPolicyService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(EditorManager) protected readonly editors: EditorManager;

    constructor() {
        super({ widgetId: POLICY_WIDGET_ID, widgetName: POLICY_WIDGET_LABEL, defaultWidgetOptions: { area: 'left', rank: 610 }, toggleCommandId: INGOT_POLICY_COMMANDS.toggle.id });
    }

    onStart(): void {
        this.policies.onDidChange(() => this.updateStatus());
        this.editors.onCurrentEditorChanged(() => this.updateStatus());
        this.updateStatus();
    }

    protected currentFolder(): string {
        const uri = this.editors.currentEditor?.editor.uri;
        const path = uri ? this.policies.relative(uri) : undefined;
        return path ? path.split('/').slice(0, -1).join('/') : '';
    }

    /** "Policy · gpt-5-mini · ≤ $0.05 · auto: read" for the folder of the open file, when a policy applies. */
    protected async updateStatus(): Promise<void> {
        const folder = this.currentFolder();
        const policy = await this.policies.effective(folder, true);
        if (!policy.layers.length) {
            this.statusBar.removeElement(POLICY_STATUS_ID);
            return;
        }
        const parts = [
            POLICY_TEXT.status,
            policy.model?.value.split('/').pop(),
            policy.maxCostPerRun ? `≤ ${formatUsd(policy.maxCostPerRun.value)}` : undefined,
            policy.autoApprove ? `auto: ${policy.autoApprove.value}` : undefined
        ].filter(Boolean);
        this.statusBar.setElement(POLICY_STATUS_ID, {
            text: `$(shield) ${parts.join(STATUS_SEPARATOR)}`,
            tooltip: [`${POLICY_TEXT.statusTooltip} (${folder || POLICY_TEXT.root})`, ...describePolicy(policy)].join('\n'),
            alignment: StatusBarAlignment.RIGHT, priority: STATUS_PRIORITY, className: 'ingot-status-policy', command: INGOT_POLICY_COMMANDS.toggle.id
        });
    }

    protected async create(dir: string): Promise<void> {
        const made = await this.policies.createTemplate(dir);
        if (!made) {
            this.messages.info(POLICY_TEXT.noProject);
            return;
        }
        if (!made.created) {
            this.messages.info(POLICY_TEXT.exists);
        }
        await open(this.opener, made.uri);
        await this.openView({ activate: false, reveal: true });
    }

    protected async createForFolder(): Promise<void> {
        if (!this.policies.root()) {
            this.messages.info(POLICY_TEXT.noProject);
            return;
        }
        const dir = (await this.quickInput.input({
            prompt: POLICY_TEXT.folderPrompt, value: this.currentFolder(), placeHolder: 'packages/api',
            validateInput: async value => value.trim() && !isSafeRelativePath(value.trim()) ? 'Use a folder inside the project.' : undefined
        }))?.trim();
        if (dir !== undefined) {
            await this.create(dir.replace(/\/+$/, ''));
        }
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(INGOT_POLICY_COMMANDS.create, { execute: () => this.create('') });
        registry.registerCommand(INGOT_POLICY_COMMANDS.folder, { execute: () => this.createForFolder() });
        registry.registerCommand(INGOT_POLICY_COMMANDS.explain, { execute: async () => (await this.openView({ activate: true, reveal: true })).refresh() });
    }
}
