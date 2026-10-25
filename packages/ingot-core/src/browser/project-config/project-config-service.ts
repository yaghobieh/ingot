import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { AGENTS_FILES, COMMANDS_DIR, CONFIG_DIRS, MCP_FILE, RULE_EXTENSIONS, RULES_DIR, SKILL_FILE, SKILLS_DIR } from '../../common/project-config/project-config.consts';
import type { ConfigSource, McpServerConfig, ProjectCommand, ProjectConfig, ProjectRule } from '../../common/project-config/project-config.types';
import { commandFromFile, mergeByName, parseMcpJson, ruleFromFile } from '../../common/project-config/project-config.utils';

const EMPTY: ProjectConfig = { rules: [], commands: [], mcpServers: [] };

/**
 * Loads a project's agent configuration (IDEA-30): `.ingot/{rules,commands,skills,mcp.json}`, plus existing rule folders
 * (`.cursor/`, legacy `.alloy/`), `AGENTS.md` and `.cursorrules`. `.ingot` wins when names clash.
 */
@injectable()
export class ProjectConfigService {

    @inject(FileService) protected readonly files: FileService;

    async load(root: URI | undefined): Promise<ProjectConfig> {
        if (!root) {
            return EMPTY;
        }
        const [external, legacy, ingot, agents] = await Promise.all([
            this.loadDir(root, CONFIG_DIRS.external, 'external'),
            this.loadDir(root, CONFIG_DIRS.legacy, 'legacy'),
            this.loadDir(root, CONFIG_DIRS.ingot, 'ingot'),
            this.loadAgentsFiles(root)
        ]);
        return {
            rules: [...agents, ...mergeByName(mergeByName(external.rules, legacy.rules), ingot.rules)],
            commands: mergeByName(mergeByName(external.commands, legacy.commands), ingot.commands),
            mcpServers: mergeByName(mergeByName(external.mcpServers, legacy.mcpServers), ingot.mcpServers)
        };
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

    protected relative(root: URI, uri: URI): string {
        return root.relative(uri)?.toString() ?? uri.path.base;
    }

    protected async loadDir(root: URI, dir: string, source: ConfigSource): Promise<{ rules: ProjectRule[]; commands: ProjectCommand[]; mcpServers: McpServerConfig[] }> {
        const base = root.resolve(dir);
        const isRule = (u: URI) => RULE_EXTENSIONS.some(ext => u.path.base.toLowerCase().endsWith(ext));
        const [ruleFiles, commandFiles, skillDirs, mcpText] = await Promise.all([
            this.children(base.resolve(RULES_DIR)), this.children(base.resolve(COMMANDS_DIR)), this.children(base.resolve(SKILLS_DIR)), this.read(base.resolve(MCP_FILE))
        ]);
        const rules = (await Promise.all(ruleFiles.filter(isRule).map(async u => {
            const text = await this.read(u);
            return text === undefined ? undefined : ruleFromFile(this.relative(root, u), text, source);
        }))).filter((r): r is ProjectRule => !!r);
        const commands = (await Promise.all(commandFiles.filter(isRule).map(async u => {
            const text = await this.read(u);
            return text === undefined ? undefined : commandFromFile(this.relative(root, u), text, source);
        }))).filter((c): c is ProjectCommand => !!c);
        const skills = (await Promise.all(skillDirs.map(async d => {
            const file = d.resolve(SKILL_FILE);
            const text = await this.read(file);
            return text === undefined ? undefined : commandFromFile(this.relative(root, file), text, source, 'skill');
        }))).filter((c): c is ProjectCommand => !!c);
        return { rules, commands: [...commands, ...skills], mcpServers: mcpText ? parseMcpJson(mcpText, source) : [] };
    }

    protected async loadAgentsFiles(root: URI): Promise<ProjectRule[]> {
        const rules = await Promise.all(AGENTS_FILES.map(async name => {
            const text = await this.read(root.resolve(name));
            return text === undefined ? undefined : ruleFromFile(name, text, 'agents');
        }));
        return rules.filter((r): r is ProjectRule => !!r);
    }
}
