import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ProjectConfigService } from '../project-config/project-config-service';
import { CONFIG_DIRS } from '../../common/project-config/project-config.consts';
import { HABITS_DIR, PLAYBOOK_EXTENSIONS, PLAYBOOK_PREFS, PLAYBOOK_SOURCE_ORDER } from '../../common/habits/playbook.consts';
import type { Playbook, PlaybookFileError, PlaybookList, PlaybookScope, PlaybookSource } from '../../common/habits/playbook.types';
import { parsePlaybook, playbookFileName } from '../../common/habits/playbook.utils';

interface PlaybookFolder {
    readonly source: PlaybookSource;
    readonly dir: URI;
    readonly label: (name: string) => string;
}

/**
 * IDEA-296 Habits v2: habit playbooks from `~/.ingot/habits` (global), `.cursor/habits` and `.ingot/habits` (project,
 * committed). Later folders win on a name clash. On/off is per user (a preference), so a team file stays untouched.
 */
@injectable()
export class PlaybookService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Ids of habits the user turned off. */
    get disabled(): readonly string[] {
        const value = this.preferences.get<unknown>(PLAYBOOK_PREFS.disabled, []);
        return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    }

    /** Off: habits are only used when the agent or the user picks one. */
    get autoSelect(): boolean {
        return this.preferences.get<boolean>(PLAYBOOK_PREFS.autoSelect, true) !== false;
    }

    isEnabled(p: Pick<Playbook, 'id'>): boolean {
        return !this.disabled.includes(p.id);
    }

    async setEnabled(p: Pick<Playbook, 'id'>, on: boolean): Promise<void> {
        const rest = this.disabled.filter(id => id !== p.id);
        await this.preferences.set(PLAYBOOK_PREFS.disabled, on ? rest : [...rest, p.id], PreferenceScope.User);
        this.onDidChangeEmitter.fire();
    }

    protected async folders(root: URI | undefined): Promise<PlaybookFolder[]> {
        const global = (await this.projectConfig.globalDir()).resolve(HABITS_DIR);
        const project = (dir: string): PlaybookFolder['label'] => name => `${dir}/${HABITS_DIR}/${name}`;
        return [
            { source: 'global', dir: global, label: name => `~/${CONFIG_DIRS.ingot}/${HABITS_DIR}/${name}` },
            ...(root ? [
                { source: 'cursor' as const, dir: root.resolve(CONFIG_DIRS.external).resolve(HABITS_DIR), label: project(CONFIG_DIRS.external) },
                { source: 'project' as const, dir: root.resolve(CONFIG_DIRS.ingot).resolve(HABITS_DIR), label: project(CONFIG_DIRS.ingot) }
            ] : [])
        ];
    }

    /** Every habit (on and off) plus the files that did not load, with their errors. */
    async list(root: URI | undefined = this.root): Promise<PlaybookList> {
        const loaded = await Promise.all((await this.folders(root)).map(folder => this.loadFolder(folder)));
        const byName = new Map<string, Playbook>();
        const errors: PlaybookFileError[] = [];
        for (const source of PLAYBOOK_SOURCE_ORDER) {
            for (const result of loaded.filter(l => l.source === source)) {
                result.playbooks.forEach(p => byName.set(p.name.toLowerCase(), p));
                errors.push(...result.errors);
            }
        }
        return { playbooks: [...byName.values()], errors };
    }

    async enabledPlaybooks(root: URI | undefined = this.root): Promise<Playbook[]> {
        return (await this.list(root)).playbooks.filter(p => this.isEnabled(p));
    }

    protected async loadFolder(folder: PlaybookFolder): Promise<{ source: PlaybookSource; playbooks: Playbook[]; errors: PlaybookFileError[] }> {
        const stat = await this.files.resolve(folder.dir).catch(() => undefined);
        const files = (stat?.children ?? []).filter(c => !c.isDirectory && PLAYBOOK_EXTENSIONS.some(ext => c.name.toLowerCase().endsWith(ext)));
        const results = await Promise.all(files.map(async f => {
            const text = await this.files.read(f.resource).then(r => r.value, () => undefined);
            const path = folder.label(f.name);
            return text === undefined ? undefined : { path, uri: f.resource.toString(), result: parsePlaybook(text, { path, source: folder.source, uri: f.resource.toString() }) };
        }));
        const playbooks: Playbook[] = [];
        const errors: PlaybookFileError[] = [];
        for (const r of results) {
            if (r?.result.playbook) {
                playbooks.push(r.result.playbook);
            } else if (r) {
                errors.push({ path: r.path, source: folder.source, uri: r.uri, errors: r.result.errors });
            }
        }
        return { source: folder.source, playbooks, errors };
    }

    async readRaw(uri: string): Promise<string> {
        return (await this.files.read(new URI(uri))).value;
    }

    /** Writes an edited habit file; returns the validation errors instead when it would not load. */
    async save(uri: string, text: string, source: PlaybookSource): Promise<readonly string[]> {
        const target = new URI(uri);
        const { errors } = parsePlaybook(text, { path: target.path.base, source });
        if (errors.length) {
            return errors;
        }
        await this.files.write(target, text);
        this.onDidChangeEmitter.fire();
        return [];
    }

    /** Writes a new habit to `.ingot/habits/<slug>.md` (or the global folder); returns the path or the errors. */
    async create(scope: PlaybookScope, text: string): Promise<{ path?: string; errors: readonly string[] }> {
        const draft = parsePlaybook(text, { path: 'habit.md', source: scope });
        if (!draft.playbook) {
            return { errors: draft.errors };
        }
        const name = playbookFileName(draft.playbook.name);
        const folder = (await this.folders(this.root)).find(f => f.source === scope);
        if (!name || !folder) {
            return { errors: [name ? 'Open a project to add project habits.' : 'Give the habit a name with letters or numbers.'] };
        }
        const target = folder.dir.resolve(name);
        if (await this.files.exists(target)) {
            return { errors: [`${folder.label(name)} already exists. Pick another name.`] };
        }
        await this.files.create(target, text);
        this.onDidChangeEmitter.fire();
        return { path: folder.label(name), errors: [] };
    }

    async remove(uri: string): Promise<void> {
        await this.files.delete(new URI(uri), { useTrash: true }).catch(() => this.files.delete(new URI(uri)));
        this.onDidChangeEmitter.fire();
    }
}
