import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { AgentStore } from '../agents/agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { ProcessStore } from '../processes/process-store';
import { HOOKS_FILE } from '../../common/git/hooks';
import { DEFAULT_HABIT_THRESHOLD, HABITS_FILE, HABITS_GITIGNORE, HABITS_GITIGNORE_ENTRY, HABITS_PREFS, MIN_HABIT_THRESHOLD } from '../../common/habits/habits.consts';
import type { Habit, HabitEvent, HabitEvidence, HabitTarget, HabitUndo, SavedHabit } from '../../common/habits/habits.types';
import type { Playbook } from '../../common/habits/playbook.types';
import {
    addStopHook, commandEvidence, habitFile, hasStopHook, instructionEvidence, learnedFocus, parseHabits, recordEvidence, rejectionEvidence, removeStopHook,
    saveHabit, serializeHabits, terminalInput, undoHabits
} from '../../common/habits/habits.utils';
import { PlaybookService } from './playbook-service';
import { HabitBus } from './habit-bus';

/**
 * IDEA-296 Habits: counts what the user repeats (instructions in prompts, terminal commands, rejected agent styles) in
 * `.ingot/habits.json` and proposes a rule, command or hook once a pattern repeats. Opt-in; nothing leaves the machine.
 */
@injectable()
export class HabitStore {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(PlaybookService) protected readonly playbooks: PlaybookService;
    @inject(HabitBus) protected readonly bus: HabitBus;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    /** Habits learned or saved a pattern: shown as a "Saved to Habits" note in the agent chat. */
    protected readonly onDidNoteEmitter = new Emitter<HabitEvent>();
    readonly onDidNote: Event<HabitEvent> = this.onDidNoteEmitter.event;
    protected revealed: string | undefined;
    protected readonly toDispose = new DisposableCollection();
    protected items: Habit[] = [];
    protected loadedFor: string | undefined;
    protected queue: Promise<void> = Promise.resolve();
    protected readonly seenProcesses = new Set<string>();
    protected readonly lineBuffers = new Map<string, string | undefined>();

    get enabled(): boolean {
        return this.preferences.get<boolean>(HABITS_PREFS.enabled, false);
    }

    set enabled(on: boolean) {
        void this.preferences.set(HABITS_PREFS.enabled, on).then(() => this.load(true));
    }

    get threshold(): number {
        return Math.max(MIN_HABIT_THRESHOLD, this.preferences.get<number>(HABITS_PREFS.threshold, DEFAULT_HABIT_THRESHOLD));
    }

    get habits(): readonly Habit[] {
        return this.items;
    }

    /** Habits waiting for an answer in the chat. */
    get proposals(): readonly Habit[] {
        return this.enabled ? this.items.filter(h => h.enabled && h.status === 'proposed') : [];
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    start(): void {
        this.toDispose.push(this.agents.onDidSend(({ prompt }) => instructionEvidence(prompt).forEach(e => this.observe(e))));
        this.toDispose.push(this.tracker.onDidReject(({ change, hunks }) => rejectionEvidence(hunks.flatMap(h => h.added), change.path).forEach(e => this.observe(e))));
        this.toDispose.push(this.processes.onDidChange(() => this.observeProcesses()));
        this.terminals.all.forEach(t => this.watchTerminal(t));
        this.toDispose.push(this.terminals.onDidCreateTerminal(t => this.watchTerminal(t)));
        this.toDispose.push(this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === HABITS_PREFS.enabled) {
                void this.load(true);
            }
        }));
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.load(true)));
        this.toDispose.push(this.bus.onDidSave(({ root, habit }) => this.saveFromFeature(root, habit)));
        void this.load();
    }

    /**
     * IDEA-302..304: a promoted decision, a learned freeze or a failed approach. Saved even while "Learn habits" is off:
     * the user did it on purpose, and the source file already holds it.
     */
    protected saveFromFeature(rootUri: string, saved: SavedHabit): void {
        this.queue = this.queue.then(async () => {
            const root = this.root;
            if (root && root.toString() === rootUri) {
                await this.load();
                this.items = saveHabit(this.items, saved, Date.now()).habits;
                await this.persist();
                return;
            }
            const other = new URI(rootUri);
            const uri = other.resolve(HABITS_FILE);
            const current = parseHabits(await this.files.read(uri).then(r => r.value, () => undefined));
            await this.files.write(uri, serializeHabits(saveHabit(current, saved, Date.now()).habits));
            await this.ignoreInGit(other);
        }).catch(() => undefined);
    }

    async load(force = false): Promise<void> {
        const root = this.root;
        const key = root?.toString();
        if (!force && key === this.loadedFor) {
            return;
        }
        this.loadedFor = key;
        this.items = root ? parseHabits(await this.files.read(root.resolve(HABITS_FILE)).then(r => r.value, () => undefined)) : [];
        this.onDidChangeEmitter.fire();
    }

    /** Counts one observation (in order, so concurrent events do not lose counts). */
    observe(evidence: HabitEvidence): void {
        if (!this.enabled || !this.root) {
            return;
        }
        this.queue = this.queue.then(async () => {
            await this.load();
            const { habits, proposed } = recordEvidence(this.items, evidence, Date.now(), this.threshold);
            this.items = habits;
            await this.persist();
            if (proposed) {
                this.onDidChangeEmitter.fire();
                this.onDidNoteEmitter.fire({ kind: 'learned', label: proposed.label, focus: learnedFocus(proposed.id), undo: { habitId: proposed.id } });
            }
        }).catch(() => undefined);
    }

    /** Writes the rule or command file (or adds a stop hook) and marks the habit accepted. */
    async accept(habit: Habit, target: HabitTarget): Promise<string | undefined> {
        const root = this.root;
        if (!root) {
            return undefined;
        }
        let savedAs: string;
        let undo: HabitUndo = { habitId: habit.id, previous: habit };
        if (target === 'hook') {
            savedAs = HOOKS_FILE;
            const uri = root.resolve(savedAs);
            const text = await this.files.read(uri).then(r => r.value, () => undefined);
            undo = hasStopHook(text, habit.label) ? undo : { ...undo, hook: habit.label };
            await this.files.write(uri, addStopHook(text, habit.label));
        } else {
            const file = habitFile(habit, target);
            savedAs = file.path;
            const uri = root.resolve(file.path);
            if (!await this.files.exists(uri)) {
                await this.files.create(uri, file.content);
                undo = { ...undo, created: uri.toString() };
            }
        }
        await this.update(habit, { status: 'accepted', savedAs });
        this.onDidNoteEmitter.fire({ kind: 'saved', label: habit.label, savedAs, focus: learnedFocus(habit.id), undo });
        return savedAs;
    }

    /** IDEA-296 v2: a habit playbook was saved, from a learned pattern (marked accepted) or from a finished run. */
    async savedPlaybook(playbook: Pick<Playbook, 'id' | 'name' | 'uri'>, savedAs: string, learned?: Habit): Promise<void> {
        if (learned) {
            await this.update(learned, { status: 'accepted', savedAs });
        }
        const undo: HabitUndo = { ...(learned ? { habitId: learned.id, previous: learned } : {}), ...(playbook.uri ? { playbook: playbook.uri } : {}) };
        this.onDidNoteEmitter.fire({ kind: 'saved', label: playbook.name, savedAs, focus: playbook.id, undo });
    }

    /** Undo on a "Saved to Habits" note: deletes what the save created and puts the learned pattern back as it was. */
    async undo(undo: HabitUndo): Promise<void> {
        const root = this.root;
        if (undo.created) {
            await this.files.delete(new URI(undo.created)).catch(() => undefined);
        }
        if (undo.playbook) {
            await this.playbooks.remove(undo.playbook).catch(() => undefined);
        }
        if (undo.hook && root) {
            const uri = root.resolve(HOOKS_FILE);
            const text = await this.files.read(uri).then(r => r.value, () => undefined);
            if (text !== undefined) {
                await this.files.write(uri, removeStopHook(text, undo.hook));
            }
        }
        if (undo.habitId) {
            await this.load();
            this.items = undoHabits(this.items, undo);
            await this.persist();
        }
    }

    /** Opens the Habits page on a learned pattern or a playbook (see `takeReveal`). */
    reveal(focus: string): void {
        this.revealed = focus;
        this.onDidChangeEmitter.fire();
    }

    /** The row the Habits page should scroll to and highlight, once. */
    takeReveal(): string | undefined {
        const focus = this.revealed;
        this.revealed = undefined;
        return focus;
    }

    async dismiss(habit: Habit): Promise<void> {
        await this.update(habit, { status: 'dismissed' });
    }

    async setHabitEnabled(habit: Habit, enabled: boolean): Promise<void> {
        await this.update(habit, { enabled });
    }

    async remove(habit: Habit): Promise<void> {
        this.items = this.items.filter(h => h.id !== habit.id);
        await this.persist();
    }

    protected async update(habit: Habit, patch: Partial<Habit>): Promise<void> {
        this.items = this.items.map(h => h.id === habit.id ? { ...h, ...patch } : h);
        await this.persist();
    }

    protected async persist(): Promise<void> {
        const root = this.root;
        if (root) {
            await this.files.write(root.resolve(HABITS_FILE), serializeHabits(this.items));
            await this.ignoreInGit(root);
        }
        this.onDidChangeEmitter.fire();
    }

    /** Keeps habits.json out of git (`.ingot/.gitignore`), like project memories. */
    protected async ignoreInGit(root: URI): Promise<void> {
        const uri = root.resolve(HABITS_GITIGNORE);
        const text = await this.files.read(uri).then(r => r.value, () => '');
        if (!text.split(/\r?\n/).some(l => l.trim() === HABITS_GITIGNORE_ENTRY)) {
            await this.files.write(uri, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${HABITS_GITIGNORE_ENTRY}\n`);
        }
    }

    /** Commands the user started from the chat's process list. */
    protected observeProcesses(): void {
        for (const p of this.processes.processes) {
            if (this.seenProcesses.has(p.id)) {
                continue;
            }
            this.seenProcesses.add(p.id);
            const evidence = p.origin === 'user' ? commandEvidence(p.command) : undefined;
            if (evidence) {
                this.observe(evidence);
            }
        }
    }

    /** Commands typed in the integrated terminal. */
    protected watchTerminal(terminal: TerminalWidget): void {
        const id = terminal.id;
        this.lineBuffers.set(id, '');
        const listener = terminal.onData(data => {
            const { buffer, lines } = terminalInput(this.lineBuffers.get(id), data);
            this.lineBuffers.set(id, buffer);
            lines.map(commandEvidence).forEach(e => e && this.observe(e));
        });
        terminal.onDidDispose(() => {
            listener.dispose();
            this.lineBuffers.delete(id);
        });
    }
}
