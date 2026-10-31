import URI from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { GitService } from '../../common/git/git.types';
import type { WorktreeSetupResult } from '../../common/threads/worktree-setup.types';
import { CursorModeService } from '../import/cursor-mode-service';

/** IDEA-287: runs worktrees.json setup in a new worktree (`.cursor/worktrees.json` only while the workspace reads `.cursor`). */
@injectable()
export class WorktreeSetupService {

    @inject(GitService) protected readonly git: GitService;
    @inject(CursorModeService) protected readonly modes: CursorModeService;

    async run(rootPath: string, folder: string): Promise<WorktreeSetupResult | undefined> {
        const readCursor = await this.modes.readsCursor(URI.fromFilePath(rootPath)).catch(() => true);
        return this.git.setupWorktree(rootPath, folder, readCursor);
    }
}
