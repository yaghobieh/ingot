import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { MERGE_TARGETS } from '../../common/import/cursor-convert.consts';
import { planCursorConversion } from '../../common/import/cursor-convert.utils';
import type { CursorConversionStep } from '../../common/import/cursor-convert.types';
import { CURSOR_SYNC_COMMAND, CURSOR_SYNC_DEBOUNCE_MS, CURSOR_SYNC_FILE, CURSOR_SYNC_PROMPT } from '../../common/import/cursor-sync.consts';
import type { CursorSyncChange, CursorSyncItem, CursorSyncManifest, CursorSyncPlan } from '../../common/import/cursor-sync.types';
import {
    applySyncPlan, conflictText, hashText, isCursorSyncPath, isMergeKind, parseSyncFile, planCursorSync, syncFileText, syncSignature, syncSummary
} from '../../common/import/cursor-sync.utils';
import { CursorImportContribution } from './cursor-import-contribution';
import { CursorModeService } from './cursor-mode-service';

interface SyncState {
    readonly plan: CursorSyncPlan;
    readonly merges: readonly CursorConversionStep[];
    readonly manifest: CursorSyncManifest;
}

/**
 * IDEA-287: in Convert mode, `.ingot` keeps following `.cursor`. A change to the Cursor files (watched, and checked on open)
 * asks "Pull changes into .ingot?"; "Cursor Config: Pull Changes into .ingot" does the same on demand. Only files the user
 * has not edited since the last sync are updated or removed; merge files (mcp.json, hooks.json, ignore files) gain new entries.
 */
@injectable()
export class CursorSyncContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(CursorModeService) protected readonly modes: CursorModeService;
    @inject(CursorImportContribution) protected readonly importer: CursorImportContribution;

    protected timer?: ReturnType<typeof setTimeout>;
    /** The pending sync the user was last asked about (not asked again until it changes). */
    protected asked = '';

    onDidInitializeLayout(): void {
        this.importer.onDidConvert(root => void this.record(root));
        this.files.onDidFilesChange(event => {
            const root = this.root();
            if (root && event.changes.some(change => {
                const relative = root.relative(change.resource)?.toString();
                return relative !== undefined && isCursorSyncPath(relative);
            })) {
                this.schedule();
            }
        });
        this.workspace.onWorkspaceChanged(() => this.schedule());
        this.schedule();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CURSOR_SYNC_COMMAND, { execute: () => this.pullNow(), isEnabled: () => !!this.root() });
    }

    protected root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    protected schedule(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.check().catch(() => undefined), CURSOR_SYNC_DEBOUNCE_MS);
    }

    /** Asks once per distinct pending change; records files that already match without asking. */
    async check(): Promise<void> {
        const root = this.root();
        if (!root || await this.modes.modeFor(root) !== 'convert') {
            return;
        }
        const state = await this.state(root);
        const { plan, merges } = state;
        if (Object.keys(plan.adopted).length || plan.forgotten.length) {
            await this.save(root, applySyncPlan(state.manifest, plan, []));
        }
        const pending = plan.changes.length + merges.length;
        const signature = syncSignature(plan, merges.map(m => m.target));
        if ((!pending && !plan.conflicts.length) || signature === this.asked) {
            return;
        }
        this.asked = signature;
        if (!pending) {
            this.messages.warn(`${CURSOR_SYNC_PROMPT.changed}. ${conflictText(plan.conflicts)}`);
            return;
        }
        const conflicts = conflictText(plan.conflicts);
        const answer = await this.messages.info(
            `${CURSOR_SYNC_PROMPT.changed} (${syncSummary(plan.changes, merges.map(m => m.target))}). Pull the changes into .ingot?${conflicts ? ` ${conflicts}` : ''}`,
            CURSOR_SYNC_PROMPT.pull, CURSOR_SYNC_PROMPT.later
        );
        if (answer === CURSOR_SYNC_PROMPT.pull) {
            await this.pull(root);
        }
    }

    protected async pullNow(): Promise<void> {
        const root = this.root();
        if (!root) {
            return;
        }
        if (await this.modes.modeFor(root) !== 'convert') {
            this.messages.info(CURSOR_SYNC_PROMPT.notConverted);
            return;
        }
        await this.pull(root);
    }

    /** Writes the pending changes and merges, then reloads rules, commands and MCP servers. */
    async pull(root: URI): Promise<void> {
        const state = await this.state(root);
        const { plan, merges } = state;
        if (!plan.changes.length && !merges.length) {
            this.messages.info([CURSOR_SYNC_PROMPT.inSync, conflictText(plan.conflicts)].filter(Boolean).join(' '));
            await this.save(root, applySyncPlan(state.manifest, plan, []));
            this.asked = syncSignature(plan, []);
            return;
        }
        const applied: CursorSyncChange[] = [];
        for (const change of plan.changes) {
            const target = root.resolve(change.target);
            try {
                if (change.action === 'remove') {
                    await this.files.delete(target);
                } else if (change.text === undefined) {
                    await this.files.copy(root.resolve(change.from), target, { overwrite: true });
                } else {
                    await this.files.write(target, change.text);
                }
                applied.push(change);
            } catch (error) {
                this.messages.error(`Could not sync ${change.target}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        for (const merge of merges) {
            await this.files.write(root.resolve(merge.target), merge.text ?? '');
        }
        await this.save(root, applySyncPlan(state.manifest, plan, applied));
        this.asked = syncSignature({ ...plan, changes: plan.changes.filter(change => !applied.includes(change)) }, []);
        await this.importer.refresh(root);
        const conflicts = conflictText(plan.conflicts);
        this.messages.info(`Pulled Cursor changes into .ingot: ${syncSummary(applied, merges.map(m => m.target))}.${conflicts ? ` ${conflicts}` : ''}`);
    }

    /** After Convert: every target that matches its Cursor file is recorded, so later changes can follow. */
    protected async record(root: URI): Promise<void> {
        const state = await this.state(root);
        await this.save(root, applySyncPlan(state.manifest, state.plan, []));
        this.asked = '';
    }

    /**
     * The Cursor config as Convert would write it now, against what `.ingot` has. A target the user already had before
     * converting (same path, or the same rule as `.mdc`) is theirs and never synced.
     */
    protected async state(root: URI): Promise<SyncState> {
        const sources = await this.importer.sources(root);
        const mergeTexts = await Promise.all(Object.values(MERGE_TARGETS).map(async (path): Promise<[string, string | undefined]> => [path, await this.read(root.resolve(path))]));
        const current = Object.fromEntries(mergeTexts.filter((entry): entry is [string, string] => entry[1] !== undefined));
        const conversion = planCursorConversion({ sources, existing: [], current });
        const manifest = await this.manifest(root);
        const texts = new Map(sources.map(source => [source.path, source.text]));
        const steps = conversion.steps.filter(step => !isMergeKind(step.kind));
        const all: CursorSyncItem[] = await Promise.all(steps.map(async step => ({
            kind: step.kind, from: step.from, target: step.target, ...(step.text !== undefined ? { text: step.text } : {}),
            sourceHash: hashText(texts.get(step.from) ?? await this.read(root.resolve(step.from)) ?? '')
        })));
        const paths = [...new Set([...all.map(item => item.target), ...Object.keys(manifest)])];
        const targets = Object.fromEntries(await Promise.all(paths.map(async path => {
            const text = await this.read(root.resolve(path));
            return [path, text === undefined ? undefined : hashText(text)] as const;
        })));
        const theirs = await Promise.all(all.map(async item => !manifest[item.target] && item.target.endsWith('.md') && await this.files.exists(root.resolve(`${item.target}c`))));
        const items = all.filter((_, i) => !theirs[i]);
        return { plan: planCursorSync({ items, manifest, targets }), merges: conversion.steps.filter(step => isMergeKind(step.kind) && step.text !== undefined), manifest };
    }

    protected async file(): Promise<URI> {
        return new URI(await this.env.getConfigDirUri()).resolve(CURSOR_SYNC_FILE);
    }

    protected async manifest(root: URI): Promise<CursorSyncManifest> {
        return parseSyncFile(await this.read(await this.file())).workspaces[root.path.fsPath()] ?? {};
    }

    protected async save(root: URI, manifest: CursorSyncManifest): Promise<void> {
        const uri = await this.file();
        await this.files.write(uri, syncFileText(parseSyncFile(await this.read(uri)), root.path.fsPath(), manifest));
    }

    protected async read(uri: URI): Promise<string | undefined> {
        return this.files.read(uri).then(content => content.value, () => undefined);
    }
}
