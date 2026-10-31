import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { CURSOR_MODE_FILE } from '../common/import/cursor-mode.consts';
import type { CursorMode } from '../common/import/cursor-mode.types';
import { agentIgnoreFileNames, cursorModeFor, indexIgnoreFileNames, parseCursorModes } from '../common/import/cursor-mode.utils';

/**
 * IDEA-287: the backend side of the per-workspace Cursor answer (`cursor-workspaces.json` in the user config folder),
 * so search and the file index read `.cursorignore` only when the workspace keeps reading `.cursor` live.
 */
@injectable()
export class CursorModeReader {

    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    protected cache?: { file: string; mtimeMs: number; modes: Record<string, CursorMode> };

    async modeFor(root: string): Promise<CursorMode | undefined> {
        const file = path.join(FileUri.fsPath(await this.env.getConfigDirUri()), CURSOR_MODE_FILE);
        const stat = await fs.promises.stat(file).catch(() => undefined);
        if (!stat) {
            return undefined;
        }
        if (this.cache?.file !== file || this.cache.mtimeMs !== stat.mtimeMs) {
            this.cache = { file, mtimeMs: stat.mtimeMs, modes: parseCursorModes(await fs.promises.readFile(file, 'utf8').catch(() => '')) };
        }
        return cursorModeFor(this.cache.modes, root);
    }

    async agentIgnoreFiles(root: string): Promise<string[]> {
        return agentIgnoreFileNames(await this.modeFor(root));
    }

    async indexIgnoreFiles(root: string): Promise<string[]> {
        const mode = await this.modeFor(root);
        return [...agentIgnoreFileNames(mode), ...indexIgnoreFileNames(mode)];
    }
}
