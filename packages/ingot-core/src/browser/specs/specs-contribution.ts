import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nextOpenTask, specSlug, taskPrompt } from '../../common/ingot-kit';
import type { SpecSummary, SpecTask } from '../../common/ingot-kit';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { AgentStore } from '../agents/agent-store';
import { SpecsService } from './specs-service';
import { IngotSpecsWidget } from './specs-widget';
import type { SpecTaskRunner } from './specs.types';
import { SPECS_COMMANDS, SPECS_TEXT, SPECS_WIDGET_ID, SPECS_WIDGET_LABEL } from './specs.consts';

/** IDEA-324: the Specs tool window, Create Spec… and Run Next Spec Task (Ingot keymap, Find Action). */
@injectable()
export class IngotSpecsContribution extends AbstractViewContribution<IngotSpecsWidget> implements SpecTaskRunner {

    @inject(SpecsService) protected readonly specs: SpecsService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(AgentStore) protected readonly store: AgentStore;

    constructor() {
        super({ widgetId: SPECS_WIDGET_ID, widgetName: SPECS_WIDGET_LABEL, defaultWidgetOptions: { area: 'left', rank: 600 }, toggleCommandId: SPECS_COMMANDS.toggle.id });
    }

    /** A new chat with the task's prompt; the agent ticks the task off with `ingot/spec_task` when done. */
    async runTask(spec: SpecSummary, task: SpecTask): Promise<void> {
        await this.commands.executeCommand(AGENT_COMMANDS.newAgent.id);
        this.store.send(taskPrompt(spec, task));
    }

    protected async createSpec(): Promise<void> {
        if (!this.specs.root()) {
            this.messages.info(SPECS_TEXT.noProject);
            return;
        }
        const name = (await this.quickInput.input({ prompt: SPECS_TEXT.namePrompt, placeHolder: 'user login', validateInput: async value => value.trim() && !specSlug(value) ? 'Use letters or digits.' : undefined }))?.trim();
        if (!name || !specSlug(name)) {
            return;
        }
        const summary = (await this.quickInput.input({ prompt: SPECS_TEXT.summaryPrompt, placeHolder: 'Sign in with email and password.' }))?.trim() ?? '';
        const spec = await this.specs.create(name, summary);
        if (!spec) {
            this.messages.warn(SPECS_TEXT.exists);
            return;
        }
        await this.openView({ activate: false, reveal: true });
        const uri = this.specs.docUri(spec.slug, 'requirements');
        if (uri) {
            await open(this.opener, uri);
        }
    }

    protected async runNext(): Promise<void> {
        const specs = await this.specs.list();
        const pending = specs.map(spec => ({ spec, task: nextOpenTask(spec.tasks) })).filter((x): x is { spec: SpecSummary; task: SpecTask } => !!x.task);
        if (!pending.length) {
            this.messages.info(specs.length ? SPECS_TEXT.allDone : SPECS_TEXT.empty);
            return;
        }
        const items = pending.map(p => ({ label: p.spec.title, description: `${p.task.id} ${p.task.title}`, value: p }));
        const pick = pending.length === 1 ? pending[0] : (await this.quickInput.pick(items, { placeHolder: SPECS_TEXT.runNext }))?.value;
        if (pick) {
            await this.runTask(pick.spec, pick.task);
        }
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(SPECS_COMMANDS.create, { execute: () => this.createSpec() });
        registry.registerCommand(SPECS_COMMANDS.runNext, { execute: () => this.runNext() });
        registry.registerCommand(SPECS_COMMANDS.refresh, { execute: async () => (await this.openView({ activate: true })).refresh() });
    }
}
