import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { type PreferenceSchema, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CONFIG_DIRS, RULES_DIR } from '../../common/project-config/project-config.consts';
import {
    CURSOR_IMPORT_ANSWERS, CURSOR_IMPORT_COMMAND, CURSOR_IMPORT_MODES, CURSOR_IMPORT_PREFERENCE, CURSOR_IMPORT_PROMPT, CURSOR_IMPORT_SNOOZE_KEY,
    CURSOR_RULES_FILE, DEFAULT_CURSOR_IMPORT_MODE
} from '../../common/import/cursor-rules-import.consts';
import type { ImportedRule } from '../../common/import/cursor-rules-import.types';
import { isRuleFile, planCursorImport, shouldPromptCursorImport, toCursorImportMode } from '../../common/import/cursor-rules-import.utils';

export const cursorImportPreferenceSchema: PreferenceSchema = {
    properties: {
        [CURSOR_IMPORT_PREFERENCE]: {
            type: 'string', enum: [...CURSOR_IMPORT_MODES], default: DEFAULT_CURSOR_IMPORT_MODE,
            enumDescriptions: ['Offer to copy Cursor rules into .ingot/rules when a project has them.', 'Never offer; run "Import Cursor Rules into .ingot" by hand.'],
            description: 'Opening a project with .cursor/rules or .cursorrules offers to import them into .ingot/rules once.'
        }
    }
};

/** IDEA-281: a project with Cursor rules gets a one-time "Import Cursor rules into .ingot?" prompt (Import / Not now / Never). */
@injectable()
export class CursorRulesImportContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(StorageService) protected readonly storage: StorageService;

    /** Roots already asked in this window, so a workspace event does not stack a second prompt. */
    protected readonly asked = new Set<string>();

    onDidInitializeLayout(): void {
        void this.offer();
        this.workspace.onWorkspaceChanged(() => void this.offer());
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CURSOR_IMPORT_COMMAND, { execute: () => this.importNow(), isEnabled: () => !!this.root() });
    }

    protected root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    protected async offer(): Promise<void> {
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root || this.asked.has(root.toString())) {
            return;
        }
        await this.preferences.ready;
        const plan = await this.plan(root);
        const mode = toCursorImportMode(this.preferences.get(CURSOR_IMPORT_PREFERENCE));
        const snoozedAt = await this.storage.getData<number>(CURSOR_IMPORT_SNOOZE_KEY);
        if (!shouldPromptCursorImport(plan.length, mode, snoozedAt, Date.now())) {
            return;
        }
        this.asked.add(root.toString());
        const { import: IMPORT, notNow: NOT_NOW, never: NEVER } = CURSOR_IMPORT_ANSWERS;
        const answer = await this.messages.info(`${CURSOR_IMPORT_PROMPT} ${this.describe(plan)}`, IMPORT, NOT_NOW, NEVER);
        if (answer === IMPORT) {
            await this.write(root, plan);
        } else if (answer === NOT_NOW) {
            await this.storage.setData(CURSOR_IMPORT_SNOOZE_KEY, Date.now());
        } else if (answer === NEVER) {
            await this.preferences.set(CURSOR_IMPORT_PREFERENCE, 'never', PreferenceScope.User);
        }
    }

    protected async importNow(): Promise<void> {
        const root = this.root();
        if (!root) {
            return;
        }
        const plan = await this.plan(root);
        if (!plan.length) {
            this.messages.info(`No Cursor rules left to import: ${CONFIG_DIRS.ingot}/${RULES_DIR} already has them.`);
            return;
        }
        await this.write(root, plan);
    }

    protected describe(plan: readonly ImportedRule[]): string {
        const sources = [...new Set(plan.map(rule => rule.from === CURSOR_RULES_FILE ? CURSOR_RULES_FILE : `${CONFIG_DIRS.external}/${RULES_DIR}`))];
        return `${plan.length} rule${plan.length === 1 ? '' : 's'} found in ${sources.join(' and ')}.`;
    }

    protected async plan(root: URI): Promise<ImportedRule[]> {
        const cursorRules = await this.ruleFiles(root.resolve(CONFIG_DIRS.external).resolve(RULES_DIR));
        const [rules, cursorrules, ingotRules] = await Promise.all([
            Promise.all(cursorRules.map(async uri => ({ fileName: uri.path.base, text: await this.read(uri) ?? '' }))),
            this.read(root.resolve(CURSOR_RULES_FILE)),
            this.ruleFiles(root.resolve(CONFIG_DIRS.ingot).resolve(RULES_DIR))
        ]);
        return planCursorImport({ rules, cursorrules, ingotRules: ingotRules.map(uri => uri.path.base) });
    }

    /** Copies the planned rules into `.ingot/rules`; a file that appeared meanwhile is never overwritten. */
    protected async write(root: URI, plan: readonly ImportedRule[]): Promise<void> {
        const dir = root.resolve(CONFIG_DIRS.ingot).resolve(RULES_DIR);
        let written = 0;
        for (const rule of plan) {
            const target = dir.resolve(rule.fileName);
            if (await this.files.exists(target)) {
                continue;
            }
            try {
                await this.files.write(target, rule.text);
                written++;
            } catch (error) {
                this.messages.error(`Could not import ${rule.from}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (written) {
            this.messages.info(`Imported ${written} Cursor rule${written === 1 ? '' : 's'} into ${CONFIG_DIRS.ingot}/${RULES_DIR}.`);
        }
    }

    protected async ruleFiles(dir: URI): Promise<URI[]> {
        const stat = await this.files.resolve(dir).catch(() => undefined);
        return (stat?.children ?? []).filter(child => child.isFile && isRuleFile(child.name)).map(child => child.resource);
    }

    protected async read(uri: URI): Promise<string | undefined> {
        return this.files.read(uri).then(content => content.value, () => undefined);
    }
}
