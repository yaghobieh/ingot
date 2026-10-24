import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AgentStore } from '../agents/agent-store';
import type { AgentSession } from '../../common/agents/agents.types';
import { IngotGroupService, type GroupProject } from './ingot-group-service';
import type { GroupMessage, GroupParticipant } from '../../common/groups/channel.types';
import { isSafeRelativePath, openQuestionFor, parseGroupCommand } from '../../common/groups/channel.utils';

const STORAGE_PREFIX = 'ingot.groupChat:';
const INBOX_TITLE = 'Group inbox';

/**
 * Group agent channel (IDEA-53): agents in different projects of a group ask, notify and reply to each other.
 * Cross-project edits are only applied after the user approves them in Group Chat.
 * `ask`, `notify`, `reply` and `requestEdit` are the tools the agent runtime calls; the composer exposes them as slash commands.
 */
@injectable()
export class GroupChannel {

    @inject(IngotGroupService) protected readonly groups: IngotGroupService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly onDidChangeEmitter = new Emitter<GroupMessage | undefined>();
    readonly onDidChange: Event<GroupMessage | undefined> = this.onDidChangeEmitter.event;

    protected items: GroupMessage[] = [];
    protected loadedFor?: string;
    protected counter = 0;

    get messages(): readonly GroupMessage[] {
        return this.items;
    }

    get pendingEdits(): number {
        return this.items.filter(m => m.edit?.status === 'pending').length;
    }

    start(): void {
        this.agents.registerCommandHandler((session, prompt) => this.handleCommand(session, prompt));
        this.groups.onDidChange(() => this.load());
        this.load();
    }

    protected get storageKey(): string | undefined {
        const group = this.groups.isGroup ? this.workspace.workspace?.resource.toString() : undefined;
        return group ? STORAGE_PREFIX + group : undefined;
    }

    protected async load(): Promise<void> {
        const key = this.storageKey;
        if (key === this.loadedFor) {
            return;
        }
        this.loadedFor = key;
        this.items = key ? await this.storage.getData<GroupMessage[]>(key, []) : [];
        this.onDidChangeEmitter.fire(undefined);
    }

    protected async persist(message?: GroupMessage): Promise<void> {
        const key = this.storageKey;
        if (key) {
            await this.storage.setData(key, this.items);
        }
        this.onDidChangeEmitter.fire(message);
    }

    protected project(nameOrUri: string): GroupProject | undefined {
        return this.groups.projects.find(p => p.name === nameOrUri || p.uri === nameOrUri);
    }

    protected participant(project: GroupProject, agent?: string): GroupParticipant {
        return { project: project.uri, projectName: project.name, agent };
    }

    protected post(message: Omit<GroupMessage, 'id' | 'at'>): GroupMessage {
        const full: GroupMessage = { ...message, id: `gm-${Date.now().toString(36)}-${this.counter++}`, at: Date.now() };
        this.items = [...this.items, full];
        this.persist(full);
        return full;
    }

    /** Delivers a message into the receiving project's agent conversation. */
    protected deliver(message: GroupMessage, label: string): void {
        const inbox = this.agents.sessionFor(message.to.project, INBOX_TITLE);
        this.agents.addMessage(inbox, { role: 'peer', from: label, text: message.text });
    }

    ask(fromProject: string, agent: string, toProject: string, question: string): GroupMessage | string {
        const from = this.project(fromProject);
        const to = this.project(toProject);
        if (!from || !to || from.uri === to.uri) {
            return this.unknownProject(toProject);
        }
        const message = this.post({ kind: 'ask', from: this.participant(from, agent), to: this.participant(to), text: question });
        this.deliver(message, `Question from ${from.name} · ${agent}`);
        return message;
    }

    notify(fromProject: string, agent: string, toProject: string, text: string): GroupMessage | string {
        const from = this.project(fromProject);
        const to = this.project(toProject);
        if (!from || !to || from.uri === to.uri) {
            return this.unknownProject(toProject);
        }
        const message = this.post({ kind: 'notify', from: this.participant(from, agent), to: this.participant(to), text });
        this.deliver(message, `Notification from ${from.name} · ${agent}`);
        return message;
    }

    reply(fromProject: string, agent: string, answer: string): GroupMessage | string {
        const from = this.project(fromProject);
        const question = from && openQuestionFor(this.items, from.uri);
        if (!from || !question) {
            return 'There is no open question for this project.';
        }
        const to = this.project(question.from.project);
        if (!to) {
            return this.unknownProject(question.from.projectName);
        }
        const message = this.post({ kind: 'reply', from: this.participant(from, agent), to: { ...this.participant(to), agent: question.from.agent }, text: answer, replyTo: question.id });
        this.deliver(message, `Reply from ${from.name} · ${agent}`);
        return message;
    }

    /** Queues a cross-project edit; nothing is written until `approve`. */
    requestEdit(fromProject: string, agent: string, toProject: string, file: string, text: string): GroupMessage | string {
        const from = this.project(fromProject);
        const to = this.project(toProject);
        if (!from || !to || from.uri === to.uri) {
            return this.unknownProject(toProject);
        }
        if (!isSafeRelativePath(file)) {
            return `Edits must stay inside ${to.name}.`;
        }
        return this.post({ kind: 'edit', from: this.participant(from, agent), to: this.participant(to), text, edit: { file, text, status: 'pending' } });
    }

    async approve(id: string): Promise<void> {
        const message = this.items.find(m => m.id === id);
        if (!message?.edit || message.edit.status !== 'pending') {
            return;
        }
        const target = new URI(message.to.project).resolve(message.edit.file);
        try {
            const current = await this.files.exists(target) ? (await this.files.read(target)).value : '';
            const separator = current && !current.endsWith('\n') ? '\n' : '';
            await this.files.write(target, `${current}${separator}${message.edit.text}\n`);
            message.edit.status = 'approved';
            this.notifySender(message, `Approved: ${message.to.projectName}/${message.edit.file} was edited.`);
            await this.editors.open(target, { mode: 'reveal' });
        } catch (error) {
            message.edit.status = 'failed';
            this.notifySender(message, `Edit failed: ${String(error)}`);
        }
        this.items = [...this.items];
        await this.persist(message);
    }

    async deny(id: string): Promise<void> {
        const message = this.items.find(m => m.id === id);
        if (!message?.edit || message.edit.status !== 'pending') {
            return;
        }
        message.edit.status = 'denied';
        this.notifySender(message, `Denied: the edit to ${message.to.projectName}/${message.edit.file} was not applied.`);
        this.items = [...this.items];
        await this.persist(message);
    }

    protected notifySender(message: GroupMessage, text: string): void {
        const session = this.agents.sessionFor(message.from.project, INBOX_TITLE);
        this.agents.addMessage(session, { role: 'system', text });
    }

    protected unknownProject(name: string): string {
        const others = this.groups.projects.map(p => p.name).join(', ');
        return `"${name}" is not another project in this group. Projects: ${others || 'none (open a project group first)'}.`;
    }

    /** Slash commands typed into an agent composer inside a group. */
    protected handleCommand(session: AgentSession, prompt: string): boolean {
        const command = parseGroupCommand(prompt);
        if (!command) {
            return false;
        }
        const project = session.project ?? this.groups.active?.uri;
        if (!this.groups.isGroup || !project) {
            session.messages.push({ role: 'system', text: 'Group commands work inside a project group (project ▾ → New Project Group…).' });
            return true;
        }
        const agent = session.title;
        const result = command.kind === 'reply' ? this.reply(project, agent, command.text)
            : command.kind === 'edit' ? this.requestEdit(project, agent, command.project, command.file, command.text)
                : command.kind === 'ask' ? this.ask(project, agent, command.project, command.text)
                    : this.notify(project, agent, command.project, command.text);
        session.messages.push({ role: 'system', text: typeof result === 'string' ? result : this.confirmation(result) });
        return true;
    }

    protected confirmation(message: GroupMessage): string {
        switch (message.kind) {
            case 'ask': return `Asked ${message.to.projectName}. The answer arrives here.`;
            case 'notify': return `Notified ${message.to.projectName}.`;
            case 'reply': return `Replied to ${message.to.projectName}.`;
            default: return `Edit to ${message.to.projectName}/${message.edit?.file} is waiting for your approval in Group Chat.`;
        }
    }
}
