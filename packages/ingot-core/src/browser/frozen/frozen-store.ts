import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ChangeTracker } from '../changes/change-tracker';
import { ProcessStore } from '../processes/process-store';
import { HabitBus } from '../habits/habit-bus';
import { GitService } from '../../common/git/git.types';
import { parseRgFiles } from '../../common/agents/workspace-tools';
import { scriptCommand } from '../../common/processes/processes.utils';
import {
    DEFAULT_INFER_MIN_AGE_DAYS, DEFAULT_REVERT_THRESHOLD, FROZEN_FILE, FROZEN_PREFS, INFER_TEST_TIMEOUT_MS, TEST_FILE_GLOB
} from '../../common/frozen/frozen.consts';
import type { FrozenState, FrozenTouch, FrozenZone, InferCandidate, InferInput, NewZone, TestRun } from '../../common/frozen/frozen.types';
import {
    dismissSuggestion, emptyFrozen, fileFrozen, freezeZone, frozenTouches, inferFrozen, normalizePath, parseFrozen, recordRevert, revertSuggestions, serializeFrozen,
    testSource, unfreezeZone, zoneId, zoneLabel
} from '../../common/frozen/frozen.utils';

const TEST_SCRIPT = 'test';

/** Why inference found nothing to suggest, or the candidates it found. */
export type InferOutcome = { readonly candidates: readonly InferCandidate[]; readonly reason?: undefined } | { readonly candidates?: undefined; readonly reason: string };

/**
 * IDEA-303 Frozen Zones: `.ingot/frozen.json` of the workspace project. The agent loop asks before an edit changes a
 * frozen file or function; rejected agent edits are counted so Ingot can suggest freezing a file the user keeps
 * reverting; stable files (green tests, old last commit) can be inferred.
 */
@injectable()
export class FrozenStore {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(GitService) protected readonly git: GitService;
    @inject(HabitBus) protected readonly bus: HabitBus;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected readonly toDispose = new DisposableCollection();
    protected state: FrozenState = emptyFrozen();
    protected queue: Promise<unknown> = Promise.resolve();

    get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    get zones(): readonly FrozenZone[] {
        return this.state.zones;
    }

    get revertThreshold(): number {
        return Math.max(1, this.preferences.get<number>(FROZEN_PREFS.revertThreshold, DEFAULT_REVERT_THRESHOLD));
    }

    /** Files the user keeps reverting agent edits to, not frozen or dismissed yet. */
    get suggestions(): readonly string[] {
        return revertSuggestions(this.state, this.revertThreshold);
    }

    get lastTests(): TestRun | undefined {
        return this.state.tests;
    }

    start(): void {
        this.toDispose.push(this.tracker.onDidReject(({ change }) => this.change(this.root, state => recordRevert(state, change.path, this.revertThreshold).state)));
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.load()));
        void this.load();
    }

    /** Re-reads the file (it may be edited by hand or come from git). */
    async load(root: URI | undefined = this.root): Promise<FrozenState> {
        const state = root ? parseFrozen(await this.files.read(root.resolve(FROZEN_FILE)).then(r => r.value, () => undefined)) : emptyFrozen();
        if (root?.toString() === this.root?.toString()) {
            this.state = state;
            this.onDidChangeEmitter.fire();
        }
        return state;
    }

    /** Whole file frozen (live edit views skip it); uses the last loaded state. */
    isFileFrozen(path: string): boolean {
        return fileFrozen(this.state.zones, path);
    }

    async touches(root: URI | undefined, path: string, before: string, after: string): Promise<FrozenTouch[]> {
        return root ? frozenTouches((await this.load(root)).zones, path, before, after) : [];
    }

    /** Freezes a file or function; a freeze learned from reverts is saved to Habits too. */
    async freeze(zone: NewZone, root: URI | undefined = this.root): Promise<FrozenZone | undefined> {
        if (!root) {
            return undefined;
        }
        const id = zoneId(zone.path, zone.symbol);
        await this.change(root, state => freezeZone(state, zone, Date.now()));
        const frozen = this.state.zones.find(z => z.id === id);
        if (frozen && zone.source === 'learned') {
            this.bus.save(root.toString(), {
                kind: 'frozen', key: `frozen:${frozen.path}`, label: frozen.path, text: `Ask before changing ${zoneLabel(frozen)}.`,
                example: `Rejected ${this.state.reverts[frozen.path] ?? 0} agent edits`, savedAs: FROZEN_FILE
            });
        }
        return frozen;
    }

    unfreeze(id: string, root: URI | undefined = this.root): Promise<void> {
        return this.change(root, state => unfreezeZone(state, id));
    }

    dismiss(path: string): Promise<void> {
        return this.change(this.root, state => dismissSuggestion(state, path));
    }

    /** A test run Ingot saw (agent checks and test commands); inference trusts only a green one. */
    recordTests(run: TestRun, root: URI | undefined = this.root): Promise<void> {
        return this.change(root, state => ({ ...state, tests: run }));
    }

    /** Stable files: runs the test script, then picks tested files whose last commit is old enough. */
    async infer(): Promise<InferOutcome> {
        const root = this.root;
        const cwd = root?.path.fsPath();
        if (!root || !cwd) {
            return { reason: 'Open a project first.' };
        }
        const scripts = await this.processes.service.scripts(cwd).catch(() => undefined);
        if (!scripts?.scripts[TEST_SCRIPT]) {
            return { reason: 'This project has no test script, so Ingot cannot tell which files are stable.' };
        }
        const command = scriptCommand(scripts.manager, TEST_SCRIPT);
        const run = await this.processes.service.run({ cwd, command, origin: 'user', timeoutMs: INFER_TEST_TIMEOUT_MS }).catch(() => undefined);
        const passed = !!run && !run.movedToBackground && run.info.status === 'exited' && run.info.exitCode === 0;
        await this.recordTests({ command, passed, at: Date.now() }, root);
        if (!passed) {
            return { reason: `\`${command}\` is not green, so nothing is inferred. Fix the tests first.` };
        }
        const found = await this.processes.service.workspaceSearch({ cwd, files: true, glob: TEST_FILE_GLOB }).catch(() => undefined);
        const tests = found ? parseRgFiles(found.text) : [];
        const inputs: InferInput[] = [];
        for (const test of tests) {
            const source = testSource(test);
            if (!source || !await this.files.exists(root.resolve(source))) {
                continue;
            }
            const [last] = await this.git.log(cwd, 1, source).catch(() => []);
            const at = last ? Date.parse(last.date) : NaN;
            inputs.push({ path: source, test: normalizePath(test), ...(Number.isFinite(at) ? { lastCommit: at } : {}) });
        }
        const minAge = this.preferences.get<number>(FROZEN_PREFS.inferMinAgeDays, DEFAULT_INFER_MIN_AGE_DAYS);
        const candidates = inferFrozen(inputs, this.state.zones, Date.now(), minAge);
        return candidates.length ? { candidates } : { reason: `No tested file is older than ${minAge} days and not frozen yet.` };
    }

    protected change(root: URI | undefined, edit: (state: FrozenState) => FrozenState): Promise<void> {
        const work = async (): Promise<void> => {
            if (!root) {
                return;
            }
            const next = edit(await this.load(root));
            await this.files.write(root.resolve(FROZEN_FILE), serializeFrozen(next));
            if (root.toString() === this.root?.toString()) {
                this.state = next;
                this.onDidChangeEmitter.fire();
            }
        };
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }
}
