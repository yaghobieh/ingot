import * as fs from 'fs';
import { injectable } from '@theia/core/shared/inversify';
import { exportWrites, planExport } from '../../common/rules-kit';
import type { ExportPlan, ExportTarget } from '../../common/rules-kit';
import type { RulesToolsService } from '../../common/rules-tools/rules-tools.types';
import { applyWrites, openProject } from './rules-project';

/** IDEA-319/320/323: the `ingot export` / `rules test` / `rules prune` engine for the IDE, on the project folder on disk. */
@injectable()
export class IngotRulesToolsService implements RulesToolsService {

    protected checkRoot(root: string): void {
        if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
            throw new Error(`${root || 'The project'} is not a folder.`);
        }
    }

    async planExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan> {
        this.checkRoot(root);
        return this.slim(planExport(openProject(root), { targets, force }));
    }

    async applyExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan> {
        this.checkRoot(root);
        applyWrites(root, exportWrites(planExport(openProject(root), { targets, force })));
        return this.planExport(root, targets, force);
    }

    /** File bodies stay on the backend; the dialog only needs paths, actions and line counts. */
    protected slim(plan: ExportPlan): ExportPlan {
        return { ...plan, files: plan.files.map(({ content: _content, before: _before, ...file }) => file) };
    }
}
