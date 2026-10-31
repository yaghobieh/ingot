import { injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { MAX_RULE_HIT_TURNS } from '../../common/rules-insight/rules-insight.consts';
import { buildRuleHitTurn } from '../../common/rules-insight/rules-insight.utils';
import type { RuleHitRecord, RuleHitTurn } from '../../common/rules-insight/rules-insight.types';

/** Per-chat history of what each agent turn loaded and why (IDEA-318). Kept for the window's lifetime. */
@injectable()
export class RuleHitsStore {

    protected readonly turns = new Map<string, RuleHitTurn[]>();
    protected counter = 0;

    protected readonly onDidChangeEmitter = new Emitter<RuleHitTurn>();
    readonly onDidChange: Event<RuleHitTurn> = this.onDidChangeEmitter.event;

    record(record: RuleHitRecord): RuleHitTurn {
        const turn = buildRuleHitTurn(record, `${record.sessionId}:${++this.counter}`, Date.now());
        const list = [...(this.turns.get(record.sessionId) ?? []), turn].slice(-MAX_RULE_HIT_TURNS);
        this.turns.set(record.sessionId, list);
        this.onDidChangeEmitter.fire(turn);
        return turn;
    }

    turnsFor(sessionId: string | undefined): readonly RuleHitTurn[] {
        return sessionId ? this.turns.get(sessionId) ?? [] : [];
    }

    lastTurn(sessionId: string | undefined): RuleHitTurn | undefined {
        return this.turnsFor(sessionId).at(-1);
    }

    /** Most recent turn of any chat. */
    get latest(): RuleHitTurn | undefined {
        return [...this.turns.values()].map(list => list.at(-1)).filter((t): t is RuleHitTurn => !!t).sort((a, b) => b.at - a.at)[0];
    }
}
