import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { ProcessService, type ProcessClient, type ProcessInfo } from '../../common/processes/processes.types';

/** IDEA-131/132: live list of agent / user processes, pushed by the backend. */
@injectable()
export class ProcessClientImpl implements ProcessClient {
    protected readonly onChangedEmitter = new Emitter<ProcessInfo[]>();
    readonly onChanged: Event<ProcessInfo[]> = this.onChangedEmitter.event;

    onProcessesChanged(processes: ProcessInfo[]): void {
        this.onChangedEmitter.fire(processes);
    }
}

@injectable()
export class ProcessStore {

    @inject(ProcessService) readonly service: ProcessService;
    @inject(ProcessClientImpl) protected readonly client: ProcessClientImpl;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected items: ProcessInfo[] = [];

    @postConstruct()
    protected init(): void {
        this.client.onChanged(list => this.set(list));
        void this.refresh();
    }

    get processes(): readonly ProcessInfo[] {
        return this.items;
    }

    get running(): readonly ProcessInfo[] {
        return this.items.filter(p => p.status === 'running');
    }

    find(id: string): ProcessInfo | undefined {
        return this.items.find(p => p.id === id);
    }

    async refresh(): Promise<void> {
        this.set(await this.service.list().catch(() => this.items));
    }

    protected set(list: ProcessInfo[]): void {
        this.items = list;
        this.onDidChangeEmitter.fire();
    }
}
