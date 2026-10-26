import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { MAX_THUMBNAIL_BYTES, THUMBNAIL_SIZE } from '../../common/preview/image-preview.consts';
import { formatBytes, imageCandidates, imageMimeType, looksLikeImagePath, toDataUrl } from '../../common/preview/image-preview.utils';

export interface ImageThumbnail {
    readonly uri: URI;
    readonly dataUrl: string;
    readonly bytes: number;
}

/** IDEA-145: finds the workspace image an editor or chat path points at and returns a small inline copy for hovers. */
@injectable()
export class ImageHoverService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly cache = new Map<string, Promise<ImageThumbnail | undefined>>();
    protected tooltip: HTMLDivElement | undefined;
    protected showing: string | undefined;

    @postConstruct()
    protected init(): void {
        this.files.onDidFilesChange(() => this.cache.clear());
    }

    thumbnail(ref: string, fromDir?: URI): Promise<ImageThumbnail | undefined> {
        const key = `${fromDir?.toString() ?? ''}|${ref}`;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.resolve(ref, fromDir).catch(() => undefined);
            this.cache.set(key, pending);
        }
        return pending;
    }

    protected async resolve(ref: string, fromDir?: URI): Promise<ImageThumbnail | undefined> {
        const roots = this.workspace.tryGetRoots().map(r => r.resource);
        const base = fromDir ?? roots[0];
        if (!base) {
            return undefined;
        }
        for (const path of imageCandidates(ref, fromDir?.path.toString(), roots.map(r => r.path.toString()))) {
            const uri = base.withPath(path);
            const stat = await this.files.resolve(uri).catch(() => undefined);
            if (!stat || stat.isDirectory || (stat.size ?? 0) > MAX_THUMBNAIL_BYTES) {
                continue;
            }
            const content = await this.files.readFile(uri);
            return { uri, dataUrl: toDataUrl(content.value.buffer, imageMimeType(path)), bytes: stat.size ?? content.value.byteLength };
        }
        return undefined;
    }

    /** Markdown for a Monaco hover: the image at thumbnail size and its file name and size. */
    hoverMarkdown(thumb: ImageThumbnail): string {
        return `![${thumb.uri.path.base}](${thumb.dataUrl}|width=${THUMBNAIL_SIZE})\n\n${thumb.uri.path.base} · ${formatBytes(thumb.bytes)}`;
    }

    /** Chat: shows a floating thumbnail next to an element whose text is an image path. */
    async showFor(anchor: HTMLElement): Promise<void> {
        const text = anchor.textContent?.trim() ?? '';
        if (!looksLikeImagePath(text)) {
            return;
        }
        this.showing = text;
        const thumb = await this.thumbnail(text);
        if (!thumb || this.showing !== text || !anchor.isConnected) {
            return;
        }
        const tip = this.tooltip ??= this.createTooltip();
        const img = tip.querySelector('img')!;
        img.src = thumb.dataUrl;
        img.alt = thumb.uri.path.base;
        tip.querySelector('.ingot-image-hover-caption')!.textContent = `${thumb.uri.path.base} · ${formatBytes(thumb.bytes)}`;
        const box = anchor.getBoundingClientRect();
        tip.style.left = `${Math.max(8, Math.min(window.innerWidth - THUMBNAIL_SIZE - 24, box.left))}px`;
        const below = box.bottom + 6;
        tip.style.top = below + THUMBNAIL_SIZE + 40 > window.innerHeight ? `${Math.max(8, box.top - THUMBNAIL_SIZE - 46)}px` : `${below}px`;
        tip.hidden = false;
    }

    hide(): void {
        this.showing = undefined;
        if (this.tooltip) {
            this.tooltip.hidden = true;
        }
    }

    protected createTooltip(): HTMLDivElement {
        const tip = document.createElement('div');
        tip.className = 'ingot-image-hover';
        tip.id = 'ingot-image-hover';
        tip.hidden = true;
        tip.innerHTML = '<div class="ingot-image-hover-art"><img draggable="false"></div><div class="ingot-image-hover-caption"></div>';
        document.body.appendChild(tip);
        return tip;
    }
}
