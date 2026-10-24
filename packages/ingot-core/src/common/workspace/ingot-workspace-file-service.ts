import { injectable } from '@theia/core/shared/inversify';
import { WorkspaceFileService, WorkspaceFileType } from '@theia/workspace/lib/common/workspace-file-service';
import { WORKSPACE_FILE_TYPES } from './workspace.consts';

/** Adds `.ingot-workspace` (default for Save As) next to `.code-workspace` and `.theia-workspace` (IDEA-51). */
@injectable()
export class IngotWorkspaceFileService extends WorkspaceFileService {
    override getWorkspaceFileTypes(): WorkspaceFileType[] {
        return WORKSPACE_FILE_TYPES.map(t => ({ ...t }));
    }
}
