import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CURSOR_MODE_FILE } from '../../common/import/cursor-mode.consts';
import type { CursorMode } from '../../common/import/cursor-mode.types';
import { cursorModeFor, cursorModesText, parseCursorModes, readsCursor } from '../../common/import/cursor-mode.utils';

/**
 * IDEA-287: the per-workspace answer to "use this workspace's Cursor config?" (convert / keep / off), stored in
 * `cursor-workspaces.json` in the user config folder so the backend's search and index see it too.
 */
@injectable()
export class CursorModeService {

    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected readonly onDidChangeEmitter = new Emitter<URI>();
    /** Fires with the workspace root whose answer changed. */
    readonly onDidChange: Event<URI> = this.onDidChangeEmitter.event;

    protected async file(): Promise<URI> {
        return new URI(await this.env.getConfigDirUri()).resolve(CURSOR_MODE_FILE);
    }

    /** Read each time (a tiny file), so an answer given in another window applies here too. */
    protected load(): Promise<Record<string, CursorMode>> {
        return this.file().then(uri => this.files.read(uri)).then(content => parseCursorModes(content.value), () => ({}));
    }

    /** The answer for a workspace root; undefined when it was never asked. */
    async modeFor(root: URI | undefined): Promise<CursorMode | undefined> {
        const path = root?.path.fsPath();
        return path ? cursorModeFor(await this.load(), path) : undefined;
    }

    /** True while the workspace reads `.cursor`, `.cursorrules` and `.cursorignore` live (`keep`, or never asked). */
    async readsCursor(root: URI | undefined): Promise<boolean> {
        return readsCursor(await this.modeFor(root));
    }

    /** Saves (or with `undefined` forgets) the answer for a workspace root. */
    async setMode(root: URI, mode: CursorMode | undefined): Promise<void> {
        const path = root.path.fsPath();
        if (!path) {
            return;
        }
        const text = cursorModesText(await this.load(), path, mode);
        await this.files.write(await this.file(), text);
        this.onDidChangeEmitter.fire(root);
    }
}
