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
import { AGENT_IGNORE_FILES, INDEX_IGNORE_FILES } from '../common/project-config/project-config.consts';
import { ignoreExcludeGlobs } from '../common/project-config/ignore-files.utils';

const existing = (root: string, names: readonly string[]): string[] =>
    names.map(name => path.join(root, name)).filter(file => fs.existsSync(file));

/**
 * IDEA-294: the codebase index (quick open's file list) leaves out paths in `.ingotignore`, `.ingotindexingignore`
 * and their Cursor counterparts, passed to ripgrep as extra ignore files (patterns relative to the root).
 */
@injectable()
export class IngotFileSearchService extends FileSearchServiceImpl {

    protected ignoreFiles: string[] = [];

    constructor(
        @inject(ILogger) @named('file-search:FileSearchServiceImpl') logger: ILogger,
        @inject(RawProcessFactory) rawProcessFactory: RawProcessFactory
    ) {
        super(logger, rawProcessFactory);
    }

    protected override doFind(rootUri: URI, options: FileSearchService.BaseOptions, accept: (fileUri: string) => void, token: CancellationToken): Promise<void> {
        // `getSearchArgs` runs synchronously inside `doFind`, so the files belong to this root.
        this.ignoreFiles = existing(FileUri.fsPath(rootUri), [...AGENT_IGNORE_FILES, ...INDEX_IGNORE_FILES]);
        return super.doFind(rootUri, options, accept, token);
    }

    protected override getSearchArgs(options: FileSearchService.BaseOptions): string[] {
        return [...super.getSearchArgs(options), ...this.ignoreFiles.flatMap(file => ['--ignore-file', file])];
    }
}

/** IDEA-294: Find in Files leaves out paths in `.ingotignore` / `.cursorignore` (as exclude globs per root). */
@injectable()
export class IngotSearchInWorkspaceServer extends RipgrepSearchInWorkspaceServer {

    constructor(
        @inject(ILogger) @named('search-in-workspace:RipgrepSearchInWorkspaceServer') logger: ILogger,
        @inject(RawProcessFactory) rawProcessFactory: RawProcessFactory
    ) {
        super(logger, rawProcessFactory);
    }

    override async search(what: string, rootUris: string[], options: SearchInWorkspaceOptions = {}): Promise<number> {
        const excludes = rootUris.flatMap(uri => existing(FileUri.fsPath(uri), AGENT_IGNORE_FILES))
            .flatMap(file => ignoreExcludeGlobs(fs.readFileSync(file, 'utf8')));
        return super.search(what, rootUris, excludes.length && !options.includeIgnored ? { ...options, exclude: [...(options.exclude ?? []), ...excludes] } : options);
    }
}
