import { injectable } from '@theia/core/shared/inversify';
import type { IconTheme } from '@theia/core/lib/browser/icon-theme-service';
import type { IconThemeContribution } from '@theia/core/lib/browser/icon-theme-contribution';
import type { DidChangeLabelEvent, LabelProviderContribution } from '@theia/core/lib/browser/label-provider';
import type { IconThemeService } from '@theia/core/lib/browser/icon-theme-service';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { fileIconClass, INGOT_FILES_THEME_ID, INGOT_FILES_THEME_LABEL } from '../../common/icons/file-icon-map';
import { badgeClasses, fileIconClasses, fileIconFor, INGOT_BADGE_THEME_ID, INGOT_BADGE_THEME_LABEL, INGOT_ICON_THEME_ID, INGOT_ICON_THEME_LABEL } from '../../common/icons/file-icons.utils';

interface FileLike { readonly resource: URI; readonly isDirectory?: boolean }

const asFile = (element: object): { name: string; isDirectory: boolean } | undefined => {
    if (element instanceof URI) {
        return { name: element.path.base, isDirectory: false };
    }
    const file = element as Partial<FileLike>;
    if (file.resource instanceof URI) {
        return { name: file.resource.path.base, isDirectory: !!file.isDirectory };
    }
    return undefined;
};

/** Ingot file icon theme: colored codicons per file kind (IDEA-36). */
@injectable()
export class IngotIconTheme implements IconTheme, IconThemeContribution, LabelProviderContribution {
    readonly id: string = INGOT_ICON_THEME_ID;
    readonly label: string = INGOT_ICON_THEME_LABEL;
    readonly description: string = 'Colored codicons for files and folders';
    protected readonly bodyClass: string = 'ingot-icon-theme';
    readonly hasFileIcons = true;
    readonly hasFolderIcons = true;

    protected readonly onDidChangeEmitter = new Emitter<DidChangeLabelEvent>();
    readonly onDidChange = this.onDidChangeEmitter.event;
    protected toDeactivate = new DisposableCollection();

    registerIconThemes(iconThemes: IconThemeService): void {
        iconThemes.register(this);
    }

    activate(): Disposable {
        if (this.toDeactivate.disposed) {
            this.toDeactivate = new DisposableCollection(Disposable.create(() => {
                document.body.classList.remove(this.bodyClass);
                this.fire();
            }));
            document.body.classList.add(this.bodyClass);
            this.fire();
        }
        return this.toDeactivate;
    }

    protected fire(): void {
        this.onDidChangeEmitter.fire({ affects: () => true });
    }

    canHandle(element: object): number {
        if (this.toDeactivate.disposed || !asFile(element)) {
            return 0;
        }
        return Number.MAX_SAFE_INTEGER - 2048;
    }

    getIcon(element: object): string | undefined {
        const file = asFile(element);
        return file ? fileIconClasses(fileIconFor(file.name, file.isDirectory)) : undefined;
    }
}

/** Ingot Badges (default, reference look): text badges like TS, JS or { } on tabs and tree, no folder icons. */
@injectable()
export class IngotBadgeIconTheme extends IngotIconTheme {
    override readonly id: string = INGOT_BADGE_THEME_ID;
    override readonly label: string = INGOT_BADGE_THEME_LABEL;
    override readonly description: string = 'Small text badges for files, no folder icons';
    protected override readonly bodyClass: string = 'ingot-badge-theme';

    override canHandle(element: object): number {
        return super.canHandle(element) ? super.canHandle(element) + 1 : 0;
    }

    override getIcon(element: object): string | undefined {
        const file = asFile(element);
        return file ? badgeClasses(file.name, file.isDirectory) : undefined;
    }
}

/** Ingot Files (default, IDEA-106): full-colour Material-style file and folder icons, in the tree, tabs and chips. */
@injectable()
export class IngotFilesIconTheme extends IngotIconTheme {
    override readonly id: string = INGOT_FILES_THEME_ID;
    override readonly label: string = INGOT_FILES_THEME_LABEL;
    override readonly description: string = 'Colour file and folder icons (Material Icon Theme, MIT)';
    protected override readonly bodyClass: string = 'ingot-files-theme';

    override canHandle(element: object): number {
        return super.canHandle(element) ? super.canHandle(element) + 2 : 0;
    }

    override getIcon(element: object): string | undefined {
        const file = asFile(element);
        return file ? fileIconClass(file.name, file.isDirectory) : undefined;
    }
}
