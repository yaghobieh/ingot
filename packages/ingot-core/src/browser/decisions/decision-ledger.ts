import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { HabitBus } from '../habits/habit-bus';
import { DECISIONS_FILE } from '../../common/decisions/decisions.consts';
import type { Decision, DecisionCandidate, DecisionCapture, DecisionConflict } from '../../common/decisions/decisions.types';
import { savedHabitKey } from '../../common/habits/habits.utils';
import { captureDecisions, decisionKey, decisionRuleFile, findConflicts, parseDecisions, serializeDecisions } from '../../common/decisions/decisions.utils';

/**
 * IDEA-302 Decision Ledger: `.ingot/decisions.md` of a project. The agent loop captures decisions the user confirms,
 * checks locked ones before edits, plans and commands, and promotes a decision confirmed often enough to a habit (an
 * always-applied rule plus an entry in Habits).
 */
@injectable()
export class DecisionLedger {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(HabitBus) protected readonly bus: HabitBus;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected items: Decision[] = [];
    protected loadedFor: string | undefined;
    protected queue: Promise<unknown> = Promise.resolve();

    get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Decisions of the project loaded last (the Settings page shows the workspace project). */
    get decisions(): readonly Decision[] {
        return this.items;
    }

    /** Reads the ledger of `root` (the workspace project by default); always re-reads, the file may be edited by hand. */
    async load(root: URI | undefined = this.root): Promise<readonly Decision[]> {
        this.loadedFor = root?.toString();
        this.items = root ? parseDecisions(await this.files.read(root.resolve(DECISIONS_FILE)).then(r => r.value, () => undefined)) : [];
        this.onDidChangeEmitter.fire();
        return this.items;
    }

    /** Locks the texts (new or confirmed again); decisions reaching the threshold become a rule and a habit. */
    capture(root: URI, texts: readonly string[]): Promise<DecisionCapture> {
        return this.enqueue(async () => {
            await this.load(root);
            const result = captureDecisions(this.items, texts, Date.now());
            let decisions = result.decisions;
            const promoted: Decision[] = [];
            for (const decision of result.promoted) {
                const rule = decisionRuleFile(decision);
                const uri = root.resolve(rule.path);
                if (!await this.files.exists(uri)) {
                    await this.files.create(uri, rule.content);
                }
                const done = { ...decision, habit: rule.path };
                decisions = decisions.map(d => d.id === decision.id ? done : d);
                promoted.push(done);
                this.bus.save(root.toString(), {
                    kind: 'decision', key: savedHabitKey('decision', decisionKey(decision.text)), label: decision.text, text: `${decision.text}.`,
                    example: `Confirmed ${decision.confirmed} times`, savedAs: rule.path
                });
            }
            await this.persist(root, decisions);
            return { decisions, captured: result.captured.map(c => decisions.find(d => d.id === c.id) ?? c), promoted };
        });
    }

    /** Manual lock: adds the decision, or locks it again when it is already in the ledger. */
    async lock(text: string, root: URI | undefined = this.root): Promise<Decision | undefined> {
        return root ? (await this.capture(root, [text])).captured[0] : undefined;
    }

    setLocked(id: string, locked: boolean, root: URI | undefined = this.root): Promise<void> {
        return this.change(root, list => list.map(d => d.id === id ? { ...d, locked } : d));
    }

    remove(id: string, root: URI | undefined = this.root): Promise<void> {
        return this.change(root, list => list.filter(d => d.id !== id));
    }

    async conflicts(root: URI | undefined, candidate: DecisionCandidate): Promise<DecisionConflict[]> {
        return root ? findConflicts(await this.load(root), candidate) : [];
    }

    protected change(root: URI | undefined, edit: (list: readonly Decision[]) => Decision[]): Promise<void> {
        return this.enqueue(async () => {
            if (root) {
                await this.persist(root, edit(await this.load(root)));
            }
        });
    }

    protected enqueue<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }

    protected async persist(root: URI, decisions: readonly Decision[]): Promise<void> {
        await this.files.write(root.resolve(DECISIONS_FILE), serializeDecisions(decisions));
        if (this.loadedFor === root.toString()) {
            this.items = [...decisions];
        }
        this.onDidChangeEmitter.fire();
    }
}
