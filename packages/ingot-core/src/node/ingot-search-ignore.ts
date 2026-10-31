import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { CancellationToken, ILogger } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { RawProcessFactory } from '@theia/process/lib/node';
import { FileSearchServiceImpl } from '@theia/file-search/lib/node/file-search-service-impl';
import type { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import { RipgrepSearchInWorkspaceServer } from '@theia/search-in-workspace/lib/node/ripgrep-search-in-workspace-server';
import type { SearchInWorkspaceOptions } from '@theia/search-in-workspace/lib/common/search-in-workspace-interface';
import { ignoreExcludeGlobs } from '../common/project-config/ignore-files.utils';
import { CursorModeReader } from './cursor-mode-reader';

const existing = (root: string, names: readonly string[]): string[] =>
    names.map(name => path.join(root, name)).filter(file => fs.existsSync(file));

/**
 * IDEA-294: the codebase index (quick open's file list) leaves out paths in `.ingotignore`, `.ingotindexingignore`
 * and (IDEA-287: when the workspace reads `.cursor` live) their Cursor counterparts, passed to ripgrep as extra ignore files.
 */
@injectable()
export class IngotFileSearchService extends FileSearchServiceImpl {

    @inject(CursorModeReader) protected readonly cursorModes: CursorModeReader;
    protected ignoreFiles: string[] = [];

    constructor(
        @inject(ILogger) @named('file-search:FileSearchServiceImpl') logger: ILogger,
        @inject(RawProcessFactory) rawProcessFactory: RawProcessFactory
    ) {
        super(logger, rawProcessFactory);
    }

    protected override async doFind(rootUri: URI, options: FileSearchService.BaseOptions, accept: (fileUri: string) => void, token: CancellationToken): Promise<void> {
        const root = FileUri.fsPath(rootUri);
        const names = await this.cursorModes.indexIgnoreFiles(root);
        // `getSearchArgs` runs synchronously inside `doFind`, so the files belong to this root.
        this.ignoreFiles = existing(root, names);
        return super.doFind(rootUri, options, accept, token);
    }

    protected override getSearchArgs(options: FileSearchService.BaseOptions): string[] {
        return [...super.getSearchArgs(options), ...this.ignoreFiles.flatMap(file => ['--ignore-file', file])];
    }
}

/** IDEA-294: Find in Files leaves out paths in `.ingotignore` / `.cursorignore` (as exclude globs per root). */
@injectable()
export class IngotSearchInWorkspaceServer extends RipgrepSearchInWorkspaceServer {

    @inject(CursorModeReader) protected readonly cursorModes: CursorModeReader;

    constructor(
        @inject(ILogger) @named('search-in-workspace:RipgrepSearchInWorkspaceServer') logger: ILogger,
        @inject(RawProcessFactory) rawProcessFactory: RawProcessFactory
    ) {
        super(logger, rawProcessFactory);
    }

    override async search(what: string, rootUris: string[], options: SearchInWorkspaceOptions = {}): Promise<number> {
        const files = await Promise.all(rootUris.map(async uri => {
            const root = FileUri.fsPath(uri);
            return existing(root, await this.cursorModes.agentIgnoreFiles(root));
        }));
        const excludes = files.flat().flatMap(file => ignoreExcludeGlobs(fs.readFileSync(file, 'utf8')));
        return super.search(what, rootUris, excludes.length && !options.includeIgnored ? { ...options, exclude: [...(options.exclude ?? []), ...excludes] } : options);
    }
}
