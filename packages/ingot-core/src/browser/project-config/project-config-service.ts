import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import {
    AGENT_IGNORE_FILES, AGENTS_FILE, AGENTS_FILES, COMMANDS_DIR, CONFIG_DIRS, EXTRA_COMMAND_DIRS, IMPORT_HOME_ENV, INDEX_IGNORE_FILES, MCP_FILE, NESTED_RULE_GLOBS,
    NESTED_RULES_MAX_DEPTH, NESTED_RULES_MAX_FILES, NESTED_RULES_TTL_MS, RULE_EXTENSIONS, RULES_DIR, SKILL_FILE, SKILLS_DIR
} from '../../common/project-config/project-config.consts';
import type { ConfigSource, IgnoreRules, McpServerConfig, ProjectCommand, ProjectConfig, ProjectRule } from '../../common/project-config/project-config.types';
import { commandFromFile, mergeByName, nestedRuleScope, parseMcpJson, ruleFromFile } from '../../common/project-config/project-config.utils';
import { withoutImportedCursorrules } from '../../common/import/cursor-rules-import.utils';
import { ignoreRules } from '../../common/project-config/ignore-files.utils';
import { parseRgFiles, SKIPPED_DIRS } from '../../common/agents/workspace-tools';
import { ProcessService } from '../../common/processes/processes.types';

interface DirConfig { rules: ProjectRule[]; commands: ProjectCommand[]; mcpServers: McpServerConfig[] }
const EMPTY_DIR: DirConfig = { rules: [], commands: [], mcpServers: [] };

/**
 * Loads agent configuration (IDEA-30, IDEA-62) for a project, merged with the user's global config:
 * - global: `~/.ingot/{rules,commands,skills/*\/SKILL.md}` and `~/.ingot/AGENTS.md`, plus imported global folders
 * - project: `.ingot/`, existing rule folders, legacy `.alloy/`, `AGENTS.md`
 * Later wins on name conflicts: imported global < global < imported project < legacy < project `.ingot`.
 * Global MCP servers (`~/.ingot/mcp.json`) are handled by IngotMcpClient.
 */
@injectable()
export class ProjectConfigService {

    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(ProcessService) protected readonly processes: ProcessService;
    protected readonly nestedCache = new Map<string, { at: number; rules: Promise<ProjectRule[]> }>();

    /** `~/.ingot` (the app configuration folder). */
    async globalDir(): Promise<URI> {
        return new URI(await this.env.getConfigDirUri());
    }

    /** Home folder whose other-tool config folders are imported (overridable for tests). */
    async importHome(): Promise<URI> {
        const override = (await this.env.getValue(IMPORT_HOME_ENV))?.value;
        if (override) {
            return URI.fromFilePath(override);
        }
        return new URI((await this.env.getHomeDirUri()));
    }

    /** Imported global folder (rules, commands, skills, mcp.json) next to `~/.ingot`. */
    async importedGlobalDir(): Promise<URI> {
        return (await this.importHome()).resolve(CONFIG_DIRS.external);
    }

    async load(root: URI | undefined): Promise<ProjectConfig> {
        const [globalDir, importedDir] = await Promise.all([this.globalDir(), this.importedGlobalDir()]);
        const label = (prefix: string, base: URI) => (u: URI) => `${prefix}/${base.relative(u)?.toString() ?? u.path.base}`;
        const home = await this.importHome();
        const [importedGlobal, global, globalAgents, globalExtra] = await Promise.all([
            this.loadDir(importedDir, 'global-imported', label('~/' + CONFIG_DIRS.external, importedDir)),
            this.loadDir(globalDir, 'global', label('~/' + CONFIG_DIRS.ingot, globalDir)),
            this.loadAgentsFiles(globalDir, 'global', name => `~/${CONFIG_DIRS.ingot}/${name}`, ['AGENTS.md']),
            this.loadExtraCommands(home, 'global-imported', u => `~/${home.relative(u)?.toString() ?? u.path.base}`)
        ]);
        const rel = (u: URI) => root?.relative(u)?.toString() ?? u.path.base;
        const [external, legacy, ingot, agents, projectExtra, nested] = root ? await Promise.all([
            this.loadDir(root.resolve(CONFIG_DIRS.external), 'external', rel),
            this.loadDir(root.resolve(CONFIG_DIRS.legacy), 'legacy', rel),
            this.loadDir(root.resolve(CONFIG_DIRS.ingot), 'ingot', rel),
            this.loadAgentsFiles(root, 'agents', name => name, AGENTS_FILES),
            this.loadExtraCommands(root, 'external', rel),
            this.loadNested(root)
        ]) : [EMPTY_DIR, EMPTY_DIR, EMPTY_DIR, [], [], []];
        return {
            rules: [
                ...globalAgents, ...withoutImportedCursorrules(agents, ingot.rules), ...mergeByName(importedGlobal.rules, global.rules, external.rules, legacy.rules, ingot.rules),
                ...nested
            ],
            // Later wins: other editors' folders (home, then project) < imported < legacy < `.ingot` (IDEA-249).
            commands: mergeByName(globalExtra, importedGlobal.commands, global.commands, projectExtra, external.commands, legacy.commands, ingot.commands),
            mcpServers: mergeByName(external.mcpServers, legacy.mcpServers, ingot.mcpServers)
        };
    }

    /**
     * IDEA-287: rules in subfolders (`packages/web/.ingot/rules`, `.cursor/rules`, `AGENTS.md`), scoped to their folder.
     * Found with ripgrep (gitignore and .ingotignore respected), cached for a few seconds per project.
     */
    async loadNested(root: URI): Promise<ProjectRule[]> {
        const key = root.toString();
        const cached = this.nestedCache.get(key);
        if (cached && Date.now() - cached.at < NESTED_RULES_TTL_MS) {
            return cached.rules;
        }
        const rules = this.findNested(root).then(paths => Promise.all(paths.map(async path => {
            const where = nestedRuleScope(path);
            const uri = root.resolve(path);
            const text = where ? await this.read(uri) : undefined;
            return where && text !== undefined ? { ...ruleFromFile(path, text, where.source, where.scope), uri: uri.toString() } : undefined;
        }))).then(list => list.filter((r): r is ProjectRule & { uri: string } => !!r));
        this.nestedCache.set(key, { at: Date.now(), rules });
        return rules;
    }

    protected async findNested(root: URI): Promise<string[]> {
        const cwd = root.path.fsPath();
        const found = cwd ? await this.processes.workspaceSearch({ cwd, files: true, globs: [...NESTED_RULE_GLOBS], agentIgnore: true }).catch(() => undefined) : undefined;
        if (found?.engine === 'ripgrep') {
            return parseRgFiles(found.text, NESTED_RULES_MAX_FILES).map(p => p.replace(/\\/g, '/'));
        }
        const paths: string[] = [];
        const isRule = (name: string) => RULE_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
        const walk = async (dir: URI, depth: number, inRules: boolean): Promise<void> => {
            if (depth > NESTED_RULES_MAX_DEPTH || paths.length >= NESTED_RULES_MAX_FILES) {
                return;
            }
            const stat = await this.files.resolve(dir).catch(() => undefined);
            for (const child of stat?.children ?? []) {
                const rel = root.relative(child.resource)?.toString() ?? child.name;
                if (child.isDirectory) {
                    const config = child.name === CONFIG_DIRS.ingot || child.name === CONFIG_DIRS.external;
                    if (inRules || config || (!SKIPPED_DIRS.has(child.name) && !child.name.startsWith('.'))) {
                        await walk(child.resource, depth + 1, inRules || /\/\.(ingot|cursor)\/rules$/.test(`/${rel}`));
                    }
                } else if ((inRules && isRule(child.name)) || child.name === AGENTS_FILE) {
                    paths.push(rel);
                }
            }
        };
        await walk(root, 0, false);
        return paths;
    }

    /** IDEA-294: `.ingotignore` / `.cursorignore` (agents, search, index) and `.ingotindexingignore` / `.cursorindexingignore` (index). */
    async ignoreRules(root: URI | undefined): Promise<IgnoreRules> {
        const read = (names: readonly string[]) => Promise.all(names.map(name => root ? this.read(root.resolve(name)) : Promise.resolve(undefined)));
        const [agent, index] = await Promise.all([read(AGENT_IGNORE_FILES), read(INDEX_IGNORE_FILES)]);
        return ignoreRules(agent, index);
    }

    /** Imported global MCP servers (default off until the user enables them). */
    async loadImportedGlobalServers(): Promise<McpServerConfig[]> {
        const text = await this.read((await this.importedGlobalDir()).resolve(MCP_FILE));
        return text ? parseMcpJson(text, 'global-imported') : [];
    }

    protected async read(uri: URI): Promise<string | undefined> {
        try {
            return (await this.files.read(uri)).value;
        } catch {
            return undefined;
        }
    }

    protected async children(uri: URI): Promise<URI[]> {
        try {
            const stat = await this.files.resolve(uri);
            return (stat.children ?? []).map(c => c.resource);
        } catch {
            return [];
        }
    }

    /** Plain files of a config subfolder (subagents, hooks) in project and global scope. */
    async listFiles(root: URI | undefined, dir: string): Promise<{ name: string; uri: URI; source: ConfigSource }[]> {
        const globalDir = await this.globalDir();
        const [global, project] = await Promise.all([
            this.children(globalDir.resolve(dir)),
            root ? this.children(root.resolve(CONFIG_DIRS.ingot).resolve(dir)) : Promise.resolve([])
        ]);
        return [...global.map(uri => ({ name: uri.path.base, uri, source: 'global' as const })), ...project.map(uri => ({ name: uri.path.base, uri, source: 'ingot' as const }))];
    }

    protected async loadDir(base: URI, source: ConfigSource, relative: (u: URI) => string): Promise<DirConfig> {
        const isRule = (u: URI) => RULE_EXTENSIONS.some(ext => u.path.base.toLowerCase().endsWith(ext));
        const [ruleFiles, commandFiles, skillDirs, mcpText] = await Promise.all([
            this.children(base.resolve(RULES_DIR)), this.children(base.resolve(COMMANDS_DIR)), this.children(base.resolve(SKILLS_DIR)), this.read(base.resolve(MCP_FILE))
        ]);
        const rules = (await Promise.all(ruleFiles.filter(isRule).map(async u => {
            const text = await this.read(u);
            return text === undefined ? undefined : { ...ruleFromFile(relative(u), text, source), uri: u.toString() };
        }))).filter((r): r is ProjectRule & { uri: string } => !!r);
        const commands = (await Promise.all(commandFiles.filter(isRule).map(async u => {
            const text = await this.read(u);
            return text === undefined ? undefined : { ...commandFromFile(relative(u), text, source), uri: u.toString() };
        }))).filter((c): c is ProjectCommand & { uri: string } => !!c);
        const skills = (await Promise.all(skillDirs.map(async d => {
            const file = d.resolve(SKILL_FILE);
            const text = await this.read(file);
            return text === undefined ? undefined : { ...commandFromFile(relative(file), text, source, 'skill'), uri: file.toString() };
        }))).filter((c): c is ProjectCommand & { uri: string } => !!c);
        return { rules, commands: [...commands, ...skills], mcpServers: mcpText ? parseMcpJson(mcpText, source) : [] };
    }

    /** IDEA-249: Markdown commands from other editors' folders under `base`; the file name is the command. */
    protected async loadExtraCommands(base: URI, source: ConfigSource, relative: (u: URI) => string): Promise<ProjectCommand[]> {
        const isMarkdown = (u: URI) => RULE_EXTENSIONS.some(ext => u.path.base.toLowerCase().endsWith(ext));
        const lists = await Promise.all(EXTRA_COMMAND_DIRS.map(async dir => {
            const files = (await this.children(base.resolve(dir))).filter(isMarkdown);
            const commands = await Promise.all(files.map(async u => {
                const text = await this.read(u);
                return text === undefined ? undefined : { ...commandFromFile(relative(u), text, source), uri: u.toString() };
            }));
            return commands.filter((c): c is ProjectCommand & { uri: string } => !!c);
        }));
        return mergeByName(...lists);
    }

    protected async loadAgentsFiles(base: URI, source: ConfigSource, path: (name: string) => string, names: readonly string[]): Promise<ProjectRule[]> {
        const rules = await Promise.all(names.map(async name => {
            const uri = base.resolve(name);
            const text = await this.read(uri);
            return text === undefined ? undefined : { ...ruleFromFile(path(name), text, source), uri: uri.toString() };
        }));
        return rules.filter((r): r is ProjectRule & { uri: string } => !!r);
    }
}
