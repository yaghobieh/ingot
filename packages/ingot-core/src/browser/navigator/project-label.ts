import { ViewContainer } from '@theia/core/lib/browser';
import { EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS } from '@theia/navigator/lib/browser/navigator-widget-factory';

export const PROJECT_VIEW_LABEL = 'Project';

/** Replaces a leading "Explorer" in a view container label with the JetBrains name "Project". */
export const toProjectLabel = (label: string, explorerLabel = EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS.label): string =>
    label.startsWith(explorerLabel) ? PROJECT_VIEW_LABEL + label.slice(explorerLabel.length) : label;

/**
 * JetBrains naming: the file tree tool window is always "Project" (IDEA-14).
 * Theia recomputes the container title (plugin views, layout restore, multi-root), so the label is
 * rewritten after every recomputation without changing the title options Theia compares against.
 */
export const pinProjectLabel = (container: ViewContainer): void => {
    const target = container as unknown as { updateTitle(): void };
    const updateTitle = target.updateTitle.bind(container);
    target.updateTitle = () => {
        updateTitle();
        container.title.label = toProjectLabel(container.title.label);
    };
    target.updateTitle();
};
