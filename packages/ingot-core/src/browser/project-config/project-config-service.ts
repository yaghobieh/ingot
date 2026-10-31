import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import {
    AGENT_MD_FILES, AGENTS_FILES, BUGBOT_FILE, BUGBOT_GLOBS, COMMANDS_DIR, CONFIG_DIRS, ENVIRONMENT_FILE, EXTRA_COMMAND_DIRS, EXTRA_SKILL_DIRS, IMPORT_HOME_ENV, MCP_FILE, NESTED_RULE_GLOBS,
    NESTED_RULES_MAX_DEPTH, NESTED_RULES_MAX_FILES, NESTED_RULES_TTL_MS, NESTED_SKILL_GLOBS, RULE_EXTENSIONS, RULES_DIR, SKILL_FILE, SKILLS_DIR, SKILLS_MAX_DEPTH,
    SUBAGENTS_DIR, TEAM_RULES_CONFIG_KEY, TEAM_RULES_DISABLED_PREF
} from '../../common/project-config/project-config.consts';
import { SUBAGENT_CURSOR_DIR, SUBAGENT_INGOT_DIR, SUBAGENT_OTHER_DIRS } from '../../common/agents/custom-subagents.consts';
import type { CustomSubagent, SubagentScope } from '../../common/agents/custom-subagents.types';
import { isSubagentFile, mergeSubagents, parseSubagentFile } from '../../common/agents/custom-subagents.utils';
import type {
    ConfigSource, IgnoreRules, McpServerConfig, ProjectCommand, ProjectConfig, ProjectEnvironment, ProjectRule, RuleReference
} from '../../common/project-config/project-config.types';
import { commandFromFile, mergeByName, nestedRuleScope, nestedSkillScope, parseMcpJson, ruleFromFile } from '../../common/project-config/project-config.utils';
import { withoutImportedCursorrules } from '../../common/import/cursor-rules-import.utils';
import { AGENTS_RULE_NAME } from '../../common/import/cursor-convert.consts';
import { agentIgnoreFileNames, indexIgnoreFileNames, readsCursor } from '../../common/import/cursor-mode.utils';
import type { CursorMode } from '../../common/import/cursor-mode.types';
import { ignoreRules } from '../../common/project-config/ignore-files.utils';
import { referenceCandidates, ruleReferences, withReferences } from '../../common/project-config/rule-references.utils';
import { activeTeamRules, parseTeamRules } from '../../common/project-config/team-rules.utils';
import { bugbotCommand, type BugbotFile } from '../../common/project-config/bugbot.utils';
import { parseEnvironmentJson } from '../../common/project-config/environment.utils';
import { parseRgFiles, SKIPPED_DIRS } from '../../common/agents/workspace-tools';
import { ProcessService } from '../../common/processes/processes.types';
import { CursorModeService } from '../import/cursor-mode-service';
import { IngotFeatureFlags } from '../config/feature-flags';
import { TeamRulesAdminService } from '../team-rules/team-rules-admin-service';

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
    @inject(CursorModeService) protected readonly cursorModes: CursorModeService;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(TeamRulesAdminService) protected readonly teamRulesAdmin: TeamRulesAdminService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    protected readonly nestedCache = new Map<string, { at: number; rules: Promise<ProjectRule[]> }>();
    protected readonly nestedSkillCache = new Map<string, { at: number; skills: Promise<ProjectCommand[]> }>();

    @postConstruct()
    protected watchCursorMode(): void {
        this.cursorModes.onDidChange(() => {
            this.nestedCache.clear();
            this.nestedSkillCache.clear();
        });
    }

    /** IDEA-287: the workspace's Cursor answer (convert / keep / off); undefined when never asked. */
    cursorMode(root: URI | undefined): Promise<CursorMode | undefined> {
        return this.cursorModes.modeFor(root);
    }

    /** IDEA-287: team rules from the account (remote config), all of them, with the ones the user turned off. */
    teamRules(): { rules: ProjectRule[]; disabled: string[] } {
        return {
            rules: this.teamRulesFromAccount(),
            disabled: this.preferences.get<string[]>(TEAM_RULES_DISABLED_PREF, []) ?? []
        };
    }

    /** The account's team rules; while the server has no team rules API, the admin's local ones (IDEA-287). */
    protected teamRulesFromAccount(): ProjectRule[] {
        const server = parseTeamRules(this.flags.config<unknown[]>(TEAM_RULES_CONFIG_KEY, []));
        return server.length ? server : parseTeamRules(this.teamRulesAdmin.local);
    }

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
        const homeLabel = (u: URI) => `~/${home.relative(u)?.toString() ?? u.path.base}`;
        const [importedGlobal, global, globalAgents, globalExtra, globalSkills] = await Promise.all([
            this.loadDir(importedDir, 'global-imported', label('~/' + CONFIG_DIRS.external, importedDir)),
            this.loadDir(globalDir, 'global', label('~/' + CONFIG_DIRS.ingot, globalDir)),
            this.loadAgentsFiles(globalDir, 'global', name => `~/${CONFIG_DIRS.ingot}/${name}`, ['AGENTS.md']),
            this.loadExtraCommands(home, 'global-imported', homeLabel),
            this.loadExtraSkills(home, 'global-imported', homeLabel)
        ]);
        const rel = (u: URI) => root?.relative(u)?.toString() ?? u.path.base;
        const mode = await this.cursorModes.modeFor(root);
        // IDEA-287: `.cursor`, `.cursorrules` and nested `.cursor/rules` are read live only while the workspace keeps them.
        const live = readsCursor(mode);
        const [external, legacy, ingot, agents, projectExtra, projectSkills, nested, bugbot, nestedSkills] = root ? await Promise.all([
            live ? this.loadDir(root.resolve(CONFIG_DIRS.external), 'external', rel) : Promise.resolve(EMPTY_DIR),
            this.loadDir(root.resolve(CONFIG_DIRS.legacy), 'legacy', rel),
            this.loadDir(root.resolve(CONFIG_DIRS.ingot), 'ingot', rel),
            this.loadAgentsFiles(root, 'agents', name => name, live ? AGENTS_FILES : AGENT_MD_FILES),
            this.loadExtraCommands(root, 'external', rel),
            this.loadExtraSkills(root, 'external', rel),
            this.loadNested(root).then(list => list.filter(rule => live || rule.source !== 'external')),
            this.loadBugbot(root, live),
            this.loadNestedSkills(root, live)
        ]) : [EMPTY_DIR, EMPTY_DIR, EMPTY_DIR, [], [], [], [], [], []];
        // IDEA-287: after "Convert to .ingot", an AGENTS.md whose copy is `<folder>/.ingot/rules/agents.md` is read from the copy only.
        const converted = (rule: ProjectRule): boolean => mode === 'convert' && rule.source === 'agents'
            && [...ingot.rules, ...nested].some(r => r.source === 'ingot' && r.name === (rule.scope ? `${rule.scope}/${AGENTS_RULE_NAME}` : AGENTS_RULE_NAME));
        const team = this.teamRules();
        const rules = [
            ...globalAgents, ...withoutImportedCursorrules(agents, ingot.rules).filter(r => !converted(r)),
            ...mergeByName(importedGlobal.rules, global.rules, external.rules, legacy.rules, ingot.rules),
            ...nested.filter(r => !converted(r)),
            ...activeTeamRules(team.rules, team.disabled)
        ];
        const review = bugbotCommand(bugbot);
        return {
            rules: root ? await Promise.all(rules.map(rule => this.withReferencedFiles(rule, root))) : rules,
            // Later wins: nested skills < other editors' folders (home, then project) < imported < legacy < `.ingot` (IDEA-249).
            commands: mergeByName(
                review ? [review] : [], nestedSkills, globalExtra, globalSkills, importedGlobal.commands, global.commands, projectExtra, projectSkills,
                external.commands, legacy.commands, ingot.commands
            ),
            mcpServers: mergeByName(external.mcpServers, legacy.mcpServers, ingot.mcpServers)
        };
    }

    /** IDEA-287: `@file` references in a rule (as in Cursor) are attached: next to the rule file first, then from the project root. */
    protected async withReferencedFiles(rule: ProjectRule, root: URI): Promise<ProjectRule> {
        const refs = rule.body.includes('@') ? ruleReferences(rule.body) : [];
        if (!refs.length) {
            return rule;
        }
        const ruleFile = rule.uri ? new URI(rule.uri) : undefined;
        const rulePath = ruleFile && root.isEqualOrParent(ruleFile) ? root.relative(ruleFile)?.toString() ?? '' : '';
        const found = await Promise.all(refs.map(async (ref): Promise<RuleReference | undefined> => {
            for (const candidate of referenceCandidates(ref, rulePath)) {
                const text = await this.read(root.resolve(candidate));
                if (text !== undefined) {
                    return { path: candidate, text };
                }
            }
            return undefined;
        }));
        const references = found.filter((r): r is RuleReference => !!r);
        return references.length ? { ...rule, body: withReferences(rule.body, references) } : rule;
    }

    /**
     * IDEA-287: Bugbot review guidance: `.ingot/BUGBOT.md` (and `.cursor/BUGBOT.md` while read live) at the root and in
     * subfolders. Feeds `/bugbot` and the agent checks of hooks.json.
     */
    async loadBugbot(root: URI | undefined, live?: boolean): Promise<BugbotFile[]> {
        if (!root) {
            return [];
        }
        const readCursor = live ?? await this.cursorModes.readsCursor(root);
        const cwd = root.path.fsPath();
        const found = cwd ? await this.processes.workspaceSearch({ cwd, files: true, globs: [...BUGBOT_GLOBS], agentIgnore: true }).catch(() => undefined) : undefined;
        const nested = found?.engine === 'ripgrep' ? parseRgFiles(found.text, NESTED_RULES_MAX_FILES).map(p => p.replace(/\\/g, '/')) : [];
        const paths = [...new Set([`${CONFIG_DIRS.ingot}/${BUGBOT_FILE}`, `${CONFIG_DIRS.external}/${BUGBOT_FILE}`, ...nested])]
            .filter(path => readCursor || !path.split('/').includes(CONFIG_DIRS.external));
        const files = await Promise.all(paths.map(async path => ({ path, text: await this.read(root.resolve(path)) })));
        return files.filter((f): f is BugbotFile => f.text !== undefined);
    }

    /**
     * IDEA-287: custom subagents for `ingot/task`. Home (`~/.codex|.claude|.cursor/agents`, `~/.ingot/agents`) then project
     * (`.codex|.claude/agents`, `.cursor/agents` while read live, `.ingot/agents`); later folders win on a name clash.
     */
    async loadSubagents(root: URI | undefined): Promise<CustomSubagent[]> {
        const [home, globalDir, live] = await Promise.all([this.importHome(), this.globalDir(), root ? this.cursorModes.readsCursor(root) : Promise.resolve(false)]);
        const homeLabel = (u: URI) => `~/${home.relative(u)?.toString() ?? u.path.base}`;
        const globalLabel = (u: URI) => `~/${CONFIG_DIRS.ingot}/${globalDir.relative(u)?.toString() ?? u.path.base}`;
        const rel = (u: URI) => root?.relative(u)?.toString() ?? u.path.base;
        const folders: { dir: URI; scope: SubagentScope; label: (u: URI) => string }[] = [
            ...[...SUBAGENT_OTHER_DIRS, SUBAGENT_CURSOR_DIR].map(dir => ({ dir: home.resolve(dir), scope: 'user' as const, label: homeLabel })),
            { dir: globalDir.resolve(SUBAGENTS_DIR), scope: 'user', label: globalLabel },
            ...(root ? [...SUBAGENT_OTHER_DIRS, ...(live ? [SUBAGENT_CURSOR_DIR] : []), SUBAGENT_INGOT_DIR].map(dir => ({ dir: root.resolve(dir), scope: 'project' as const, label: rel })) : [])
        ];
        const lists = await Promise.all(folders.map(async folder => {
            const files = (await this.children(folder.dir)).filter(u => isSubagentFile(u.path.base));
            const agents = await Promise.all(files.map(async u => {
                const text = await this.read(u);
                return text === undefined ? undefined : parseSubagentFile(folder.label(u), text, folder.scope);
            }));
            return agents.filter((a): a is CustomSubagent => !!a);
        }));
        return mergeSubagents(...lists);
    }

    /** IDEA-287: `.ingot/environment.json`, else `.cursor/environment.json` while read live. */
    async loadEnvironment(root: URI | undefined): Promise<{ environment: ProjectEnvironment; source: string } | undefined> {
        if (!root) {
            return undefined;
        }
        const live = await this.cursorModes.readsCursor(root);
        for (const dir of live ? [CONFIG_DIRS.ingot, CONFIG_DIRS.external] : [CONFIG_DIRS.ingot]) {
            const source = `${dir}/${ENVIRONMENT_FILE}`;
            const environment = parseEnvironmentJson(await this.read(root.resolve(source)), source);
            if (environment) {
                return { environment, source };
            }
        }
        return undefined;
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
                } else if ((inRules && isRule(child.name)) || (AGENT_MD_FILES as readonly string[]).includes(child.name)) {
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
        const mode = await this.cursorModes.modeFor(root);
        const [agent, index] = await Promise.all([read(agentIgnoreFileNames(mode)), read(indexIgnoreFileNames(mode))]);
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

    /** IDEA-287: rule files in a rules folder and its subfolders (`rules/frontend/components.mdc`, as Cursor reads them). */
    protected async ruleFilesIn(dir: URI, depth = 0): Promise<URI[]> {
        const stat = depth > NESTED_RULES_MAX_DEPTH ? undefined : await this.files.resolve(dir).catch(() => undefined);
        const lists = await Promise.all((stat?.children ?? []).map(child => child.isDirectory
            ? this.ruleFilesIn(child.resource, depth + 1)
            : Promise.resolve(RULE_EXTENSIONS.some(ext => child.name.toLowerCase().endsWith(ext)) ? [child.resource] : [])));
        return lists.flat();
    }

    protected async loadDir(base: URI, source: ConfigSource, relative: (u: URI) => string): Promise<DirConfig> {
        const isRule = (u: URI) => RULE_EXTENSIONS.some(ext => u.path.base.toLowerCase().endsWith(ext));
        const rulesDir = base.resolve(RULES_DIR);
        const [ruleFiles, commandFiles, skillFiles, mcpText] = await Promise.all([
            this.ruleFilesIn(rulesDir), this.children(base.resolve(COMMANDS_DIR)), this.skillFilesIn(base.resolve(SKILLS_DIR)), this.read(base.resolve(MCP_FILE))
        ]);
        const rules = (await Promise.all(ruleFiles.map(async u => {
            const text = await this.read(u);
            const sub = rulesDir.relative(u.parent)?.toString();
            const rule = text === undefined ? undefined : ruleFromFile(relative(u), text, source);
            return rule && { ...rule, ...(sub ? { name: `${sub}/${rule.name}` } : {}), uri: u.toString() };
        }))).filter((r): r is ProjectRule & { uri: string } => !!r);
        const commands = (await Promise.all(commandFiles.filter(isRule).map(async u => {
            const text = await this.read(u);
            return text === undefined ? undefined : { ...commandFromFile(relative(u), text, source), uri: u.toString() };
        }))).filter((c): c is ProjectCommand & { uri: string } => !!c);
        const skills = await this.readSkills(skillFiles, source, relative);
        return { rules, commands: [...commands, ...skills], mcpServers: mcpText ? parseMcpJson(mcpText, source) : [] };
    }

    /** IDEA-287: the `SKILL.md` files of a skills folder, also inside category folders (`skills/shipping/land-it/SKILL.md`). */
    protected async skillFilesIn(dir: URI, depth = 0): Promise<URI[]> {
        const stat = depth > SKILLS_MAX_DEPTH ? undefined : await this.files.resolve(dir).catch(() => undefined);
        const children = stat?.children ?? [];
        if (depth && children.some(c => !c.isDirectory && c.name === SKILL_FILE)) {
            return [dir.resolve(SKILL_FILE)];
        }
        return (await Promise.all(children.filter(c => c.isDirectory).map(c => this.skillFilesIn(c.resource, depth + 1)))).flat();
    }

    protected async readSkills(files: readonly URI[], source: ConfigSource, relative: (u: URI) => string): Promise<(ProjectCommand & { uri: string })[]> {
        const skills = await Promise.all(files.map(async file => {
            const text = await this.read(file);
            return text === undefined ? undefined : { ...commandFromFile(relative(file), text, source, 'skill'), uri: file.toString() };
        }));
        return skills.filter((c): c is ProjectCommand & { uri: string } => !!c);
    }

    /**
     * IDEA-287: skills in subfolders (`apps/web/.cursor/skills/deploy-web/SKILL.md`), scoped to that subfolder.
     * `.cursor` ones only while the workspace reads `.cursor` live. Found with ripgrep, cached like nested rules.
     */
    async loadNestedSkills(root: URI, live: boolean): Promise<ProjectCommand[]> {
        const key = root.toString();
        const cached = this.nestedSkillCache.get(key);
        const all = cached && Date.now() - cached.at < NESTED_RULES_TTL_MS ? cached.skills : this.findNestedSkills(root);
        if (all !== cached?.skills) {
            this.nestedSkillCache.set(key, { at: Date.now(), skills: all });
        }
        return (await all).filter(skill => live || !skill.path.split('/').includes(CONFIG_DIRS.external));
    }

    protected async findNestedSkills(root: URI): Promise<ProjectCommand[]> {
        const cwd = root.path.fsPath();
        const found = cwd ? await this.processes.workspaceSearch({ cwd, files: true, globs: [...NESTED_SKILL_GLOBS], agentIgnore: true }).catch(() => undefined) : undefined;
        const paths = found?.engine === 'ripgrep' ? parseRgFiles(found.text, NESTED_RULES_MAX_FILES).map(p => p.replace(/\\/g, '/')) : [];
        const skills = await Promise.all(paths.map(async path => {
            const scope = nestedSkillScope(path);
            const text = scope ? await this.read(root.resolve(path)) : undefined;
            const source: ConfigSource = path.split('/').includes(CONFIG_DIRS.ingot) ? 'ingot' : 'external';
            return scope && text !== undefined ? { ...commandFromFile(path, text, source, 'skill'), scope, uri: root.resolve(path).toString() } : undefined;
        }));
        return skills.filter((s): s is ProjectCommand & { uri: string; scope: string } => !!s);
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

    /** IDEA-287: `<dir>/<name>/SKILL.md` skills from the shared folders (`.agents/skills`, `.claude/skills`, `.codex/skills`) under `base`. */
    protected async loadExtraSkills(base: URI, source: ConfigSource, relative: (u: URI) => string): Promise<ProjectCommand[]> {
        const lists = await Promise.all(EXTRA_SKILL_DIRS.map(async dir => this.readSkills(await this.skillFilesIn(base.resolve(dir)), source, relative)));
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
