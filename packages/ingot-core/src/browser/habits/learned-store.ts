import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { DEFAULT_HABIT_THRESHOLD, HABITS_GITIGNORE, HABITS_PREFS, MIN_HABIT_THRESHOLD } from '../../common/habits/habits.consts';
import { LEARNED_FILE, LEARNED_GITIGNORE_ENTRY } from '../../common/habits/learned.consts';
import type { LearnedEvidence, LearnedHabit } from '../../common/habits/learned.types';
import { parseLearned, recordLearned, savedValue, serializeLearned } from '../../common/habits/learned.utils';

/**
 * IDEA-305/306/307: what Habits learns from the user's choices (handoff turn threshold, plan templates, model per task
 * type) in `.ingot/habits-learned.json`. Same opt-in and threshold as Habits (Settings › Habits); nothing leaves the machine.
 * Reads the Habits preferences directly so the agent loop can use it without depending on HabitStore.
 */
@injectable()
export class LearnedHabitStore {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected items: LearnedHabit[] = [];
    protected loadedFor: string | undefined;
    protected queue: Promise<unknown> = Promise.resolve();

    get enabled(): boolean {
        return this.preferences.get<boolean>(HABITS_PREFS.enabled, false);
    }

    get threshold(): number {
        return Math.max(MIN_HABIT_THRESHOLD, this.preferences.get<number>(HABITS_PREFS.threshold, DEFAULT_HABIT_THRESHOLD));
    }

    get learned(): readonly LearnedHabit[] {
        return this.items;
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    async load(force = false): Promise<readonly LearnedHabit[]> {
        const root = this.root;
        const key = root?.toString();
        if (force || key !== this.loadedFor) {
            this.loadedFor = key;
            this.items = root ? parseLearned(await this.files.read(root.resolve(LEARNED_FILE)).then(r => r.value, () => undefined)) : [];
            this.onDidChangeEmitter.fire();
        }
        return this.items;
    }

    /** The applied value of a saved habit, when Habits is on. */
    async value(id: string): Promise<string | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        return savedValue(await this.load(), id);
    }

    /** Same as `value` from what is loaded already (for render-time estimates). */
    valueNow(id: string): string | undefined {
        return this.enabled ? savedValue(this.items, id) : undefined;
    }

    /** Counts one choice; resolves to the habit when this choice saved it (show "Saved to Habits" once). */
    record(evidence: LearnedEvidence): Promise<LearnedHabit | undefined> {
        if (!this.enabled || !this.root) {
            return Promise.resolve(undefined);
        }
        const next = this.queue.then(async () => {
            await this.load();
            const { learned, saved } = recordLearned(this.items, evidence, Date.now(), this.threshold);
            this.items = learned;
            await this.persist();
            return saved;
        }).catch(() => undefined);
        this.queue = next;
        return next;
    }

    async markSavedAs(id: string, savedAs: string): Promise<void> {
        await this.update(id, { savedAs });
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        await this.update(id, { enabled });
    }

    async remove(id: string): Promise<void> {
        await this.load();
        this.items = this.items.filter(h => h.id !== id);
        await this.persist();
    }

    protected async update(id: string, patch: Partial<LearnedHabit>): Promise<void> {
        await this.load();
        this.items = this.items.map(h => h.id === id ? { ...h, ...patch } : h);
        await this.persist();
    }

    protected async persist(): Promise<void> {
        const root = this.root;
        if (root) {
            await this.files.write(root.resolve(LEARNED_FILE), serializeLearned(this.items));
            await this.ignoreInGit(root);
        }
        this.onDidChangeEmitter.fire();
    }

    protected async ignoreInGit(root: URI): Promise<void> {
        const uri = root.resolve(HABITS_GITIGNORE);
        const text = await this.files.read(uri).then(r => r.value, () => '');
        if (!text.split(/\r?\n/).some(l => l.trim() === LEARNED_GITIGNORE_ENTRY)) {
            await this.files.write(uri, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${LEARNED_GITIGNORE_ENTRY}\n`);
        }
    }
}
