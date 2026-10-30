import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type URI from '@theia/core/lib/common/uri';
import { AgentStore } from '../agents/agent-store';
import type { AgentSession } from '../../common/agents/agents.types';
import { ProjectConfigService } from './project-config-service';
import { AGENTS_FILE } from '../../common/project-config/project-config.consts';
import { INIT_COMMAND, INIT_SKIPPED_FOLDERS } from '../../common/project-config/init-agents.consts';
import { packageManagerOf, packageSignals, scaffoldAgentsMd } from '../../common/project-config/init-agents.utils';
import type { RepoSignals } from '../../common/project-config/init-agents.types';

/** IDEA-295: `/init` in the agent composer writes AGENTS.md from the repo (or opens the existing one). */
@injectable()
export class InitAgentsContribution implements FrontendApplicationContribution {

    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;

    onStart(): void {
        this.agents.registerCommandHandler((session, prompt) => {
            if (prompt.trim().toLowerCase() !== INIT_COMMAND) {
                return false;
            }
            void this.init(session);
            return true;
        });
    }

    protected async init(session: AgentSession): Promise<void> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            this.reply(session, 'Open a project folder first, then run /init.');
            return;
        }
        const target = root.resolve(AGENTS_FILE);
        if (await this.files.exists(target)) {
            this.reply(session, `${AGENTS_FILE} already exists, so it was left as is. Opened it for editing.`);
            await this.editors.open(target).catch(() => undefined);
            return;
        }
        const text = scaffoldAgentsMd(await this.signals(root));
        await this.files.create(target, text);
        this.reply(session, `Wrote ${AGENTS_FILE} from the repo (stack, scripts, layout). Review and edit it; agents follow it on every request.`);
        await this.editors.open(target).catch(() => undefined);
    }

    protected async signals(root: URI): Promise<RepoSignals> {
        const stat = await this.files.resolve(root).catch(() => undefined);
        const children = stat?.children ?? [];
        const files = children.filter(c => !c.isDirectory).map(c => c.name).sort();
        const folders = children.filter(c => c.isDirectory && !INIT_SKIPPED_FOLDERS.includes(c.name) && (!c.name.startsWith('.') || c.name === '.github' || c.name === '.ingot'))
            .map(c => c.name).sort();
        const pkg = packageSignals(await this.files.read(root.resolve('package.json')).then(r => r.value, () => undefined));
        const rules = (await this.projectConfig.listFiles(root, 'rules').catch(() => [])).filter(r => r.source === 'ingot').map(r => `.ingot/rules/${r.name}`);
        return {
            name: pkg?.name ?? root.path.base,
            ...(pkg?.description ? { description: pkg.description } : {}),
            ...(packageManagerOf(files) ? { packageManager: packageManagerOf(files) } : {}),
            scripts: pkg?.scripts ?? {},
            dependencies: pkg?.dependencies ?? [],
            files, folders,
            ...(pkg?.workspaces ? { workspaces: pkg.workspaces } : {}),
            rules
        };
    }

    protected reply(session: AgentSession, text: string): void {
        session.messages.push({ role: 'agent', text });
        session.status = 'idle';
        session.updatedAt = Date.now();
        this.agents.changed();
    }
}
