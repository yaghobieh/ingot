import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import {
    approvalVerdict, budgetViolation, commandViolation, commonFolder, domainViolation, estimateCost, filterDeniedLines, filterDeniedTree, formatUsd,
    LOCK_FILE, packForPath, parseLock, priceFor, readDenial, WEB_SEARCH_HOST
} from '../../common/ingot-kit';
import type { ApprovalKindName, ApprovalVerdict, EffectivePolicy, PolicyViolation } from '../../common/ingot-kit';
import { estimateTokens } from '../../common/agents/context-usage';
import type { AgentToolCall } from '../../common/agents/agent-protocol';
import type { AgentActionResult } from '../../common/agents/agent-actions-service';
import { BUILTIN_TOOL_SERVER } from '../../common/agents/agent-actions';
import type { ChatMessage } from '../../common/models/models.types';
import { findModel } from '../../common/models/models.utils';
import { AgentAuditLog } from '../policy/agent-audit-log';
import { IngotPolicyService } from './ingot-policy-service';
import { POLICY_AUDIT_TOOL_PREFIX, POLICY_VIOLATIONS_KEPT } from './ingot-policy.consts';
import type { EditCheck, PolicyRunState, RecordedViolation } from './ingot-policy.types';

const READ_TOOLS = new Set(['read_file', 'list_dir', 'glob', 'grep']);
const URL_TOOLS = new Set(['web_fetch', 'browser_open']);
const COMMAND_TOOLS = new Set(['run', 'run_script']);
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const clean = (path: string): string => path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');

/**
 * IDEA-325 / IDEA-326: what `.ingot/policy.yaml` means for one agent run. The agent store asks it before a tool call
 * (deny-read, allowed commands and hosts, org-enforced pack files), after one (hide denied paths, redact secrets),
 * before each model round (max cost per run) and for approvals (auto-approve level). Violations go to the audit log.
 */
@injectable()
export class AgentPolicyGate {

    @inject(IngotPolicyService) protected readonly policies: IngotPolicyService;
    @inject(AgentAuditLog) protected readonly audit: AgentAuditLog;
    @inject(FileService) protected readonly files: FileService;

    protected readonly runs = new Map<string, PolicyRunState>();
    protected readonly recent: RecordedViolation[] = [];
    protected readonly onDidViolateEmitter = new Emitter<RecordedViolation>();
    readonly onDidViolate: Event<RecordedViolation> = this.onDidViolateEmitter.event;

    get violations(): readonly RecordedViolation[] {
        return this.recent;
    }

    /** Starts a run: the policy of the folder that holds the run's files (the open file and @-mentions), spend reset to 0. */
    async prepareRun(sessionId: string, root: URI | undefined, paths: readonly string[], costTier?: string): Promise<PolicyRunState> {
        const folder = commonFolder(paths.map(clean).filter(Boolean));
        const [policy, scan, lockText] = await Promise.all([
            this.policies.effective(folder, true, root),
            this.policies.scan(root),
            root ? this.files.read(root.resolve(LOCK_FILE)).then(file => file.value, () => undefined) : Promise.resolve(undefined)
        ]);
        const state: PolicyRunState = {
            root, folder, policy,
            denyRead: scan.layers.flatMap(layer => (layer.policy.secrets?.denyRead ?? []).map(pattern => ({ pattern, dir: layer.dir, file: layer.file }))),
            redact: await this.policies.redactor(policy, root),
            lock: parseLock(lockText),
            price: priceFor(policy, findModel(policy.model?.value ?? '')?.cost ?? costTier),
            spent: 0,
            pendingInputTokens: 0
        };
        this.runs.set(sessionId, state);
        return state;
    }

    protected async state(sessionId: string, root: URI | undefined): Promise<PolicyRunState> {
        return this.runs.get(sessionId) ?? this.prepareRun(sessionId, root, []);
    }

    run(sessionId: string): PolicyRunState | undefined {
        return this.runs.get(sessionId);
    }

    /** Deny-read for any project path: every policy file's globs, each within its own folder. */
    protected denyPolicy(state: PolicyRunState): EffectivePolicy {
        return { ...state.policy, denyRead: state.denyRead };
    }

    async canRead(sessionId: string, root: URI | undefined, path: string): Promise<boolean> {
        return !readDenial(this.denyPolicy(await this.state(sessionId, root)), path);
    }

    /** The model the nearest policy picks for this run, if any. */
    modelFor(sessionId: string): { model: string; file: string } | undefined {
        const model = this.runs.get(sessionId)?.policy.model;
        return model ? { model: model.value, file: model.file } : undefined;
    }

    hasPolicy(sessionId: string): boolean {
        const state = this.runs.get(sessionId);
        return !!state && (state.policy.layers.length > 0 || state.denyRead.length > 0);
    }

    /** Before a model round: the stop message when this round would go over `budget.maxCostPerRun`. */
    beforeRound(sessionId: string, messages: readonly ChatMessage[]): string | undefined {
        const state = this.runs.get(sessionId);
        if (!state) {
            return undefined;
        }
        state.pendingInputTokens = estimateTokens(messages.map(m => m.content).join('\n'));
        const projected = state.spent + estimateCost(state.price, state.pendingInputTokens, 0);
        const violation = budgetViolation(state.policy, projected);
        if (!violation) {
            return undefined;
        }
        const message = `${violation.message} The next model call would cost about ${formatUsd(projected - state.spent)}; this run has spent ${formatUsd(state.spent)}.`;
        this.record(sessionId, `${BUILTIN_TOOL_SERVER}/model`, { folder: state.folder || '.' }, { ...violation, message });
        return message;
    }

    afterRound(sessionId: string, output: string): void {
        const state = this.runs.get(sessionId);
        if (state) {
            state.spent += estimateCost(state.price, state.pendingInputTokens, estimateTokens(output));
            state.pendingInputTokens = 0;
        }
    }

    approval(sessionId: string, kind: ApprovalKindName): ApprovalVerdict {
        return approvalVerdict(this.runs.get(sessionId)?.policy.autoApprove?.value, kind);
    }

    /** Refuses a tool call the policy does not allow (and records it); undefined lets it run. */
    async check(sessionId: string, call: AgentToolCall, root: URI | undefined): Promise<PolicyViolation | undefined> {
        if (call.server !== BUILTIN_TOOL_SERVER) {
            return undefined;
        }
        const state = await this.state(sessionId, root);
        const path = clean(str(call.args.path));
        let violation: PolicyViolation | undefined;
        if (READ_TOOLS.has(call.tool) && path) {
            const rule = readDenial(this.denyPolicy(state), path, call.tool !== 'read_file');
            violation = rule && { rule: 'secrets.denyRead', subject: path, file: rule.file, message: `Reading ${path} is denied by secrets.denyRead "${rule.pattern}" in ${rule.file}.` };
        } else if (call.tool === 'delete' && path) {
            violation = this.writeViolation(state, path);
        } else if (COMMAND_TOOLS.has(call.tool)) {
            const cwd = clean(str(call.args.cwd));
            const commandPolicy = { ...(await this.policies.effective(cwd, true, root)), denyRead: state.denyRead };
            violation = commandViolation(commandPolicy, str(call.args.command) || `npm run ${str(call.args.script)}`, cwd);
        } else if (URL_TOOLS.has(call.tool)) {
            violation = domainViolation(state.policy, str(call.args.url));
        } else if (call.tool === 'web_search') {
            violation = domainViolation(state.policy, `https://${WEB_SEARCH_HOST}/`);
        }
        if (violation) {
            this.record(sessionId, `${call.server}/${call.tool}`, call.args, violation);
        }
        return violation;
    }

    /** Org-enforced pack files and deny-read files are never written or deleted by the agent. */
    protected writeViolation(state: PolicyRunState, path: string): PolicyViolation | undefined {
        const owner = packForPath(state.lock, path);
        if (owner?.pack.enforced) {
            return { rule: 'packs.enforced', subject: path, file: LOCK_FILE, message: `${path} comes from ${owner.key}@${owner.pack.version}, a rule pack your organization enforces; it cannot be changed or removed.` };
        }
        const rule = readDenial(this.denyPolicy(state), path);
        return rule && { rule: 'secrets.denyRead', subject: path, file: rule.file, message: `${path} is denied by secrets.denyRead "${rule.pattern}" in ${rule.file}; the agent cannot change it.` };
    }

    async filterEdits<T extends { path: string }>(sessionId: string, edits: readonly T[], root: URI | undefined): Promise<{ kept: T[]; refused: string[] }> {
        const state = await this.state(sessionId, root);
        const kept: T[] = [];
        const refused: string[] = [];
        for (const edit of edits) {
            const violation = this.writeViolation(state, clean(edit.path));
            if (violation) {
                refused.push(`Skipped ${edit.path}: ${violation.message}`);
                this.record(sessionId, `${BUILTIN_TOOL_SERVER}/edit`, { path: edit.path }, violation);
            } else {
                kept.push(edit);
            }
        }
        return { kept, refused } satisfies EditCheck;
    }

    /** Hides denied paths from search and listing output, then redacts secrets from any tool result. */
    filterResult(sessionId: string, call: AgentToolCall, result: AgentActionResult): AgentActionResult {
        const state = this.runs.get(sessionId);
        if (!state) {
            return result;
        }
        let text = result.text;
        if (call.server === BUILTIN_TOOL_SERVER && (call.tool === 'grep' || call.tool === 'glob')) {
            text = filterDeniedLines(this.denyPolicy(state), text).text;
        } else if (call.server === BUILTIN_TOOL_SERVER && call.tool === 'list_dir') {
            text = filterDeniedTree(this.denyPolicy(state), text, clean(str(call.args.path))).text;
        }
        return { ...result, text: state.redact(text).text };
    }

    redact(sessionId: string, text: string): string {
        const state = this.runs.get(sessionId);
        return state ? state.redact(text).text : text;
    }

    /** Everything sent to the model, redacted (rules, context files, chat history and tool results). */
    redactMessages(sessionId: string, messages: readonly ChatMessage[]): ChatMessage[] {
        const state = this.runs.get(sessionId);
        return state ? messages.map(message => ({ ...message, content: state.redact(message.content).text })) : [...messages];
    }

    protected record(sessionId: string, tool: string, args: Record<string, unknown>, violation: PolicyViolation): void {
        const entry: RecordedViolation = { ...violation, at: Date.now(), tool, sessionId };
        this.recent.unshift(entry);
        this.recent.splice(POLICY_VIOLATIONS_KEPT);
        this.onDidViolateEmitter.fire(entry);
        const state = this.runs.get(sessionId);
        if (state && !state.policy.audit) {
            return;
        }
        this.audit.record({
            sessionId,
            project: state?.root?.path.fsPath(),
            tool: tool.startsWith(POLICY_AUDIT_TOOL_PREFIX) ? tool : `${POLICY_AUDIT_TOOL_PREFIX}${tool}`,
            summary: violation.message,
            args,
            decision: 'denied',
            reason: `${violation.rule}: ${violation.subject} (${violation.file})`,
            outcome: 'blocked'
        });
    }
}
