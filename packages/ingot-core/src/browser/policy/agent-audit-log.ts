import { Emitter, type Event } from '@theia/core/lib/common/event';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AgentAuditService, type AuditEntry, type AuditEntryInput } from '../../common/audit/agent-audit.types';

/** IDEA-263: the agent's side of the audit log. Recording never blocks or fails a tool call. */
@injectable()
export class AgentAuditLog {

    @inject(AgentAuditService) readonly service: AgentAuditService;

    protected readonly onDidAppendEmitter = new Emitter<AuditEntry>();
    readonly onDidAppend: Event<AuditEntry> = this.onDidAppendEmitter.event;

    record(input: AuditEntryInput): void {
        void this.service.append(input).then(entry => this.onDidAppendEmitter.fire(entry), (error: unknown) => {
            console.warn('Ingot audit log: could not record a tool call.', error);
        });
    }
}
