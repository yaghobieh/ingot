import { inject, injectable } from '@theia/core/shared/inversify';
import type { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import URI from '@theia/core/lib/common/uri';
import { GIT_URI_SCHEME } from '../../common/git/git.consts';
import { GitService } from '../../common/git/git.types';

export interface GitRevisionQuery {
    readonly root: string;
    readonly ref: string;
    readonly path: string;
}

/** `ingot-git:/<path>?{"root","ref","path"}`: a read-only file at a revision, used by the log's diff viewer. */
export const toGitUri = (query: GitRevisionQuery): URI =>
    new URI().withScheme(GIT_URI_SCHEME).withPath(`/${query.path}`).withQuery(JSON.stringify(query));

@injectable()
export class GitResourceResolver implements ResourceResolver {

    @inject(GitService) protected readonly git: GitService;

    async resolve(uri: URI): Promise<Resource> {
        if (uri.scheme !== GIT_URI_SCHEME) {
            throw new Error(`Not a ${GIT_URI_SCHEME} URI`);
        }
        const query = JSON.parse(uri.query) as GitRevisionQuery;
        return {
            uri,
            readOnly: true,
            readContents: async () => (query.ref ? await this.git.show(query.root, query.ref, query.path) : undefined) ?? '',
            dispose: () => undefined
        };
    }
}
