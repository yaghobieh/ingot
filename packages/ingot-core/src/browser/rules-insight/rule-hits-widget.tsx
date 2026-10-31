import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AgentStore } from '../agents/agent-store';
import { RuleHitsStore } from './rule-hits-store';
import { RulesInsightService, type RuleHitTurn } from '../../common/rules-insight/rules-insight.types';
import { RULE_HITS_LABEL, RULE_HITS_WIDGET_ID } from '../../common/rules-insight/rules-insight.consts';
import { formatTokens, globalRelative, promptPreview } from '../../common/rules-insight/rules-insight.utils';
import { KIND_LABELS, SOURCE_LABELS } from '../../common/rules-engine/rules-engine.consts';
import { packLabel } from '../../common/rules-engine/provenance.utils';
import type { RuleHit, RuleProvenance } from '../../common/rules-engine/rules-engine.types';
import { HIT_ICONS, PROVENANCE_TEXT } from './rules-insight.browser-consts';

/** Rule Hits tool window (IDEA-318): per agent turn, which rules, AGENTS.md files and habits loaded, why, and at what cost. */
@injectable()
export class RuleHitsWidget extends ReactWidget {

    @inject(RuleHitsStore) protected readonly store: RuleHitsStore;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(RulesInsightService) protected readonly service: RulesInsightService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected sessionId?: string;
    protected selected?: { turn: string; hit: string };
    protected readonly provenance = new Map<string, RuleProvenance | Error>();

    @postConstruct()
    protected init(): void {
        this.id = RULE_HITS_WIDGET_ID;
        this.title.label = RULE_HITS_LABEL;
        this.title.caption = RULE_HITS_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-law';
        this.addClass('ingot-toolwindow');
        this.node.tabIndex = 0;
        this.toDispose.push(this.store.onDidChange(turn => {
            if (!this.sessionId || turn.sessionId === this.agents.current?.id) {
                this.sessionId = turn.sessionId;
            }
            this.update();
        }));
        this.toDispose.push(this.agents.onDidChange(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    /** Shows a chat's turns, the last one expanded. */
    showSession(sessionId: string | undefined): void {
        this.sessionId = sessionId ?? this.agents.current?.id ?? this.store.latest?.sessionId;
        this.selected = undefined;
        this.update();
    }

    protected get turns(): readonly RuleHitTurn[] {
        return this.store.turnsFor(this.sessionId ?? this.agents.current?.id ?? this.store.latest?.sessionId);
    }

    protected async select(turn: RuleHitTurn, hit: RuleHit): Promise<void> {
        const same = this.selected?.turn === turn.id && this.selected.hit === hit.id;
        this.selected = same ? undefined : { turn: turn.id, hit: hit.id };
        this.update();
        const root = turn.root ?? this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
        if (same || !root || this.provenance.has(hit.path)) {
            return;
        }
        try {
            this.provenance.set(hit.path, await this.service.provenance(root, hit.path));
        } catch (error) {
            this.provenance.set(hit.path, error instanceof Error ? error : new Error(String(error)));
        }
        this.update();
    }

    protected async openRule(path: string): Promise<void> {
        const global = globalRelative(path);
        const root = this.workspace.tryGetRoots()[0]?.resource;
        const uri = global !== undefined ? new URI(await this.env.getConfigDirUri()).resolve(global) : root?.resolve(path);
        if (uri) {
            await open(this.opener, uri);
        }
    }

    protected render(): React.ReactNode {
        const turns = [...this.turns].reverse();
        const titled = this.agents.allSessions.filter(s => this.store.turnsFor(s.id).length);
        const current = this.sessionId ?? this.agents.current?.id ?? this.store.latest?.sessionId;
        return <div className='ingot-tw ingot-rh'>
            <div className='ingot-tw-header'>
                <span className='ingot-tw-title'>{RULE_HITS_LABEL}</span>
                {titled.length > 1 && <select className='ingot-rh-session' aria-label='Chat' value={current} onChange={e => this.showSession(e.currentTarget.value)}>
                    {titled.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>}
            </div>
            {!turns.length && <div className='ingot-tw-empty'>Send a message in Agents to see which rules, AGENTS.md files and habits each turn loads, and why.</div>}
            {turns.map((turn, i) => this.renderTurn(turn, i === 0))}
        </div>;
    }

    protected renderTurn(turn: RuleHitTurn, latest: boolean): React.ReactNode {
        return <section key={turn.id} className={`ingot-rh-turn${latest ? ' latest' : ''}`} aria-label={`Turn: ${promptPreview(turn.prompt)}`}>
            <div className='ingot-rh-turn-head'>
                <span className='codicon codicon-comment' />
                <span className='ingot-rh-prompt' title={turn.prompt}>{promptPreview(turn.prompt) || '(no prompt)'}</span>
                <span className='ingot-rh-tokens' title='Estimated tokens these instructions add to the turn'>~{formatTokens(turn.tokens)} tokens</span>
            </div>
            {!turn.hits.length && <div className='ingot-tw-empty'>No rules loaded for this turn.</div>}
            <ul className='ingot-tw-list'>
                {turn.hits.map(hit => this.renderHit(turn, hit))}
            </ul>
        </section>;
    }

    protected renderHit(turn: RuleHitTurn, hit: RuleHit): React.ReactNode {
        const open = this.selected?.turn === turn.id && this.selected.hit === hit.id;
        return <li key={hit.id} className={`ingot-rh-hit${open ? ' open' : ''}`}>
            <button type='button' className='ingot-tw-row ingot-rh-row' aria-expanded={open} title={hit.path} onClick={() => this.select(turn, hit)}>
                <span className={`codicon codicon-${HIT_ICONS[hit.source]}`} />
                <span className='ingot-tw-name'>{hit.name}</span>
                <span className={`ingot-rh-reason ingot-rh-reason-${hit.reason.code}`}>{hit.reason.label}</span>
                <span className='ingot-tw-detail'>{hit.reason.detail}</span>
                <span className='ingot-rh-tokens'>~{formatTokens(hit.tokens)}</span>
            </button>
            {open && this.renderProvenance(hit)}
        </li>;
    }

    protected renderProvenance(hit: RuleHit): React.ReactNode {
        const info = this.provenance.get(hit.path);
        const pack = info instanceof Error ? undefined : packLabel(info?.pack);
        return <div className='ingot-rh-card' role='region' aria-label={`Provenance of ${hit.name}`}>
            <dl>
                <dt>{PROVENANCE_TEXT.file}</dt>
                <dd><button type='button' className='ingot-tw-link' onClick={() => this.openRule(hit.path)}>{hit.path}</button></dd>
                <dt>{PROVENANCE_TEXT.source}</dt>
                <dd>{info && !(info instanceof Error) ? info.sourceLabel : SOURCE_LABELS[hit.source]} · {KIND_LABELS[hit.kind]}</dd>
                {!info && <><dt>{PROVENANCE_TEXT.git}</dt><dd className='ingot-rh-muted'>{PROVENANCE_TEXT.loading}</dd></>}
                {info instanceof Error && <><dt>{PROVENANCE_TEXT.git}</dt><dd className='ingot-rh-muted'>{info.message}</dd></>}
                {info && !(info instanceof Error) && <>
                    <dt>{PROVENANCE_TEXT.author}</dt>
                    <dd className='ingot-rh-author'>{info.lastCommit ? `${info.lastCommit.author} · ${new Date(info.lastCommit.date).toLocaleDateString()}` : PROVENANCE_TEXT.notCommitted}
                        {info.uncommitted && info.lastCommit && <span className='ingot-rh-badge'>{PROVENANCE_TEXT.uncommitted}</span>}</dd>
                    {info.lastCommit && <><dt>{PROVENANCE_TEXT.commit}</dt><dd title={info.lastCommit.sha}>{info.lastCommit.subject}</dd></>}
                    {info.firstCommit && info.firstCommit.sha !== info.lastCommit?.sha && <><dt>{PROVENANCE_TEXT.added}</dt>
                        <dd>{info.firstCommit.author} · {new Date(info.firstCommit.date).toLocaleDateString()}</dd></>}
                    <dt>{PROVENANCE_TEXT.pack}</dt>
                    <dd className='ingot-rh-pack'>{pack ?? PROVENANCE_TEXT.noPack}</dd>
                </>}
            </dl>
        </div>;
    }
}
