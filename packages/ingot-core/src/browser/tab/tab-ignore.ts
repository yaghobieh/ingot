import { inject, injectable } from '@theia/core/shared/inversify';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TAB_DEFAULT_IGNORE, TAB_IGNORE_FILE, TAB_SCHEMES } from '../../common/tab/tab.consts';
import { isIgnoredPath, parseIgnoreRules } from '../../common/tab/tab-ignore.utils';

const LINE_BREAK = /\r?\n/;

/** Decides whether a document may be sent to a model: its workspace `.ingotignore` plus built-in secret patterns. */
@injectable()
export class IngotTabIgnore {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;

    /** Read on every check (after the debounce) so an edited `.ingotignore` applies to the very next request. */
    async isIgnored(uri: URI): Promise<boolean> {
        if (!TAB_SCHEMES.includes(uri.scheme)) {
            return true;
        }
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(uri));
        const relative = root?.resource.relative(uri)?.toString() ?? uri.path.base;
        const lines = root ? await this.readLines(root.resource.resolve(TAB_IGNORE_FILE)) : [];
        return isIgnoredPath(relative, parseIgnoreRules([...TAB_DEFAULT_IGNORE, ...lines]));
    }

    protected async readLines(uri: URI): Promise<string[]> {
        try {
            return (await this.files.read(uri)).value.split(LINE_BREAK);
        } catch {
            return [];
        }
    }
}
