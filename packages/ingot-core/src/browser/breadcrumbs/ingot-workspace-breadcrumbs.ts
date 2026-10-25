import { injectable } from '@theia/core/shared/inversify';
import type { Breadcrumb } from '@theia/core/lib/browser';
import type { Disposable } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { FilepathBreadcrumb } from '@theia/filesystem/lib/browser/breadcrumbs/filepath-breadcrumb';
import { WorkspaceBreadcrumbsContribution } from '@theia/workspace/lib/browser/workspace-breadcrumbs-contribution';

/** Path segments: the project root (folder icon) › folders › file (file-type icon); a folder segment lists that folder (IDEA-76). */
@injectable()
export class IngotWorkspaceBreadcrumbs extends WorkspaceBreadcrumbsContribution {

    protected override filterBreadcrumbs(uri: URI, breadcrumb: FilepathBreadcrumb): boolean {
        const root = this.workspaceService.getWorkspaceRootUri(uri);
        return (!!root && breadcrumb.uri.isEqual(root)) || super.filterBreadcrumbs(uri, breadcrumb);
    }

    override getIconClassCreator(fileURI: URI): (location: URI, index: number) => string {
        const root = this.workspaceService.getWorkspaceRootUri(fileURI);
        return location => location.isEqual(fileURI) ? `${this.labelProvider.getIcon(location)} file-icon`
            : root?.isEqual(location) ? 'codicon codicon-folder ingot-bc-root-icon' : '';
    }

    override async attachPopupContent(breadcrumb: Breadcrumb, parent: HTMLElement): Promise<Disposable | undefined> {
        if (breadcrumb.type === this.type && FilepathBreadcrumb.is(breadcrumb) && breadcrumb.containerClass !== 'file') {
            // Theia lists the segment's siblings; for a folder we list its own files instead.
            const inside = new FilepathBreadcrumb(breadcrumb.uri.resolve('.ingot-folder-listing'), breadcrumb.label, breadcrumb.longLabel, '', 'file');
            return super.attachPopupContent(inside, parent);
        }
        return super.attachPopupContent(breadcrumb, parent);
    }
}
