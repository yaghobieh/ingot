import { inject, injectable } from '@theia/core/shared/inversify';
import { HoverService, LabelProvider, type Breadcrumb } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FilepathBreadcrumb } from '@theia/filesystem/lib/browser/breadcrumbs/filepath-breadcrumb';
import { OutlineBreadcrumb } from '@theia/outline-view/lib/browser/outline-breadcrumbs-contribution';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import * as monaco from '@theia/monaco-editor-core';
import { GitService } from '../../common/git/git.types';
import { docComment, formatSize, gitStatusLabel, parseLastCommit, symbolSignature } from '../../common/breadcrumbs/breadcrumbs.utils';

interface RangeLike { readonly start: { readonly line: number } }

/** Info tooltip for breadcrumb segments (IDEA-76): files show path, size, modified, git status and last commit; symbols show signature and doc. */
@injectable()
export class BreadcrumbHover {

    @inject(HoverService) protected readonly hover: HoverService;
    @inject(FileService) protected readonly files: FileService;
    @inject(GitService) protected readonly git: GitService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(LabelProvider) protected readonly labels: LabelProvider;

    async show(breadcrumb: Breadcrumb, target: HTMLElement): Promise<void> {
        const content = await this.content(breadcrumb).catch(() => undefined);
        if (content && target.isConnected && target.matches(':hover')) {
            this.hover.requestHover({ content, target, position: 'bottom' });
        }
    }

    protected async content(breadcrumb: Breadcrumb): Promise<HTMLElement | undefined> {
        // Outline crumbs carry a uri too, so test for them first.
        if (OutlineBreadcrumb.is(breadcrumb)) {
            const node = Array.isArray(breadcrumb.node) ? undefined : breadcrumb.node as OutlineBreadcrumb['node'] & { range?: RangeLike };
            return node?.range ? this.symbolContent(breadcrumb.uri, this.labels.getName(node), node.range) : undefined;
        }
        if (FilepathBreadcrumb.is(breadcrumb)) {
            return this.fileContent(breadcrumb.uri, breadcrumb.containerClass === 'file');
        }
        return undefined;
    }

    protected async fileContent(uri: URI, isFile: boolean): Promise<HTMLElement> {
        const box = this.box();
        this.row(box, 'ingot-bc-hover-title', uri.path.fsPath());
        const stat = await this.files.resolve(uri, { resolveMetadata: true }).catch(() => undefined);
        if (stat) {
            this.row(box, 'ingot-bc-hover-meta', [isFile && stat.size !== undefined ? formatSize(stat.size) : undefined,
                stat.mtime ? `Modified ${new Date(stat.mtime).toLocaleString()}` : undefined].filter(Boolean).join(' · '));
        }
        const root = this.workspace.getWorkspaceRootUri(uri);
        const relative = root?.relative(uri)?.toString();
        if (root && relative) {
            const rootPath = root.path.fsPath();
            const [status, last] = await Promise.all([
                this.git.run(rootPath, { kind: 'statusPath', path: relative }).then(r => gitStatusLabel(r.output)).catch(() => undefined),
                this.git.run(rootPath, { kind: 'lastCommit', path: relative }).then(r => parseLastCommit(r.output)).catch(() => undefined)
            ]);
            if (status) {
                this.row(box, 'ingot-bc-hover-git', `Git: ${status}`);
            }
            if (last) {
                this.row(box, 'ingot-bc-hover-commit', `${last.hash.slice(0, 8)} · ${last.author} · ${last.date ? new Date(last.date).toLocaleDateString() : ''}`);
                this.row(box, 'ingot-bc-hover-subject', last.subject);
            }
        }
        return box;
    }

    protected symbolContent(uri: URI, name: string, range: RangeLike): HTMLElement {
        const box = this.box();
        const model = monaco.editor.getModel(monaco.Uri.parse(uri.toString()));
        const lines = model ? model.getLinesContent() : [];
        this.row(box, 'ingot-bc-hover-signature', symbolSignature(lines, range.start.line) || name);
        const doc = docComment(lines, range.start.line);
        if (doc) {
            this.row(box, 'ingot-bc-hover-doc', doc);
        }
        return box;
    }

    protected box(): HTMLElement {
        const box = document.createElement('div');
        box.className = 'ingot-bc-hover';
        return box;
    }

    protected row(box: HTMLElement, className: string, text: string): void {
        if (!text) {
            return;
        }
        const el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        box.appendChild(el);
    }
}
