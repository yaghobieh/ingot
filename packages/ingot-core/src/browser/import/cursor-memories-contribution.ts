import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CONFIG_DIRS } from '../../common/project-config/project-config.consts';
import { CURSOR_IMPORT_PREFERENCE } from '../../common/import/cursor-rules-import.consts';
import { toCursorImportMode } from '../../common/import/cursor-rules-import.utils';
import {
    CURSOR_MEMORIES_COMMAND, CURSOR_MEMORIES_OFFERED_KEY, CURSOR_MEMORIES_PROMPT, CURSOR_MEMORY_SOURCES
} from '../../common/import/cursor-memories.consts';
import type { CursorMemory } from '../../common/import/cursor-memories.types';
import {
    cursorMemoriesOffer, cursorMemoriesSignature, cursorMemoriesSummary, isCursorMemoryFile, newCursorMemories, parseCursorMemoriesJson, parseCursorMemoryFile
} from '../../common/import/cursor-memories.utils';
import type { MemoryScope } from '../../common/memories/memories.types';
import { MemoryStore } from '../agents/memory-store';
import { ProjectConfigService } from '../project-config/project-config-service';
import { CursorModeService } from './cursor-mode-service';

/**
 * IDEA-287: Cursor memories found on disk (`.cursor/memories`, `.cursor/memories.json`, and the same in `~/.cursor`) are
 * offered once after the workspace imports its Cursor config; "Cursor Config: Import Memories" imports them any time.
 * Project ones become repo facts, the user's become preferences; ones Ingot already has are skipped.
 */
@injectable()
export class CursorMemoriesContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(CursorModeService) protected readonly modes: CursorModeService;
    @inject(MemoryStore) protected readonly memories: MemoryStore;

    onDidInitializeLayout(): void {
        void this.offer();
        this.workspace.onWorkspaceChanged(() => void this.offer());
        this.modes.onDidChange(() => void this.offer());
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CURSOR_MEMORIES_COMMAND, { execute: () => this.importNow() });
    }

    protected root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Asks only where the user chose to import the Cursor config, and once per set of memories. */
    protected async offer(): Promise<void> {
        const root = this.root();
        await this.preferences.ready;
        const mode = await this.modes.modeFor(root);
        if (!root || (mode !== 'convert' && mode !== 'keep') || toCursorImportMode(this.preferences.get(CURSOR_IMPORT_PREFERENCE)) !== 'ask') {
            return;
        }
        const pending = await this.pending(root);
        const offered = this.offered();
        const signature = cursorMemoriesSignature(pending);
        if (!pending.length || offered[root.toString()] === signature) {
            return;
        }
        localStorage.setItem(CURSOR_MEMORIES_OFFERED_KEY, JSON.stringify({ ...offered, [root.toString()]: signature }));
        const answer = await this.messages.info(cursorMemoriesOffer(pending), CURSOR_MEMORIES_PROMPT.import, CURSOR_MEMORIES_PROMPT.later);
        if (answer === CURSOR_MEMORIES_PROMPT.import) {
            await this.save(pending, root);
        }
    }

    protected offered(): Record<string, string> {
        try {
            return JSON.parse(localStorage.getItem(CURSOR_MEMORIES_OFFERED_KEY) ?? '{}') as Record<string, string>;
        } catch {
            return {};
        }
    }

    async importNow(): Promise<void> {
        const root = this.root();
        const pending = await this.pending(root);
        if (!pending.length) {
            this.messages.info(CURSOR_MEMORIES_PROMPT.none);
            return;
        }
        await this.save(pending, root);
    }

    protected async save(pending: readonly CursorMemory[], root: URI | undefined): Promise<void> {
        const saved: CursorMemory[] = [];
        for (const memory of pending) {
            if (await this.memories.save(memory.scope, memory.text, root, memory.scope === 'project' ? 'fact' : 'preference')) {
                saved.push(memory);
            }
        }
        this.messages.info(`Imported ${cursorMemoriesSummary(saved)} into Ingot memory.`);
    }

    /** Memories on disk that Ingot memory does not have yet. Without a workspace only `~/.cursor` is read. */
    async pending(root: URI | undefined): Promise<CursorMemory[]> {
        const home = await this.projectConfig.importedGlobalDir();
        const found = [
            ...(root ? await this.read(root.resolve(CONFIG_DIRS.external), 'project', CONFIG_DIRS.external) : []),
            ...await this.read(home, 'global', `~/${CONFIG_DIRS.external}`)
        ];
        return newCursorMemories(found, await this.memories.load(root));
    }

    protected async read(dir: URI, scope: MemoryScope, label: string): Promise<CursorMemory[]> {
        const found: CursorMemory[] = [];
        for (const source of CURSOR_MEMORY_SOURCES) {
            const uri = dir.resolve(source.path);
            if (source.kind === 'json') {
                const text = await this.text(uri);
                found.push(...parseCursorMemoriesJson(text ?? '').map(memory => ({ text: memory, scope, from: `${label}/${source.path}` })));
                continue;
            }
            const stat = await this.files.resolve(uri).catch(() => undefined);
            for (const child of (stat?.children ?? []).filter(c => c.isFile && isCursorMemoryFile(c.name)).sort((a, b) => a.name.localeCompare(b.name))) {
                const text = parseCursorMemoryFile(await this.text(child.resource) ?? '');
                if (text) {
                    found.push({ text, scope, from: `${label}/${source.path}/${child.name}` });
                }
            }
        }
        return found;
    }

    protected async text(uri: URI): Promise<string | undefined> {
        return this.files.read(uri).then(content => content.value, () => undefined);
    }
}
