import { injectable } from '@theia/core/shared/inversify';
import type { IconTheme } from '@theia/core/lib/browser/icon-theme-service';
import type { IconThemeContribution } from '@theia/core/lib/browser/icon-theme-contribution';
import type { DidChangeLabelEvent, LabelProviderContribution } from '@theia/core/lib/browser/label-provider';
import type { IconThemeService } from '@theia/core/lib/browser/icon-theme-service';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { fileIconClasses, fileIconFor, INGOT_ICON_THEME_ID, INGOT_ICON_THEME_LABEL } from '../../common/icons/file-icons.utils';

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
    readonly id = INGOT_ICON_THEME_ID;
    readonly label = INGOT_ICON_THEME_LABEL;
    readonly description = 'Colored codicons for files and folders';
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
                document.body.classList.remove('ingot-icon-theme');
                this.fire();
            }));
            document.body.classList.add('ingot-icon-theme');
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
