import { ViewContainer, ViewContainerTitleOptions } from '@theia/core/lib/browser';
import { EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS } from '@theia/navigator/lib/browser/navigator-widget-factory';

export const PROJECT_VIEW_LABEL = 'Project';

/**
 * JetBrains naming: the file tree tool window is always "Project" (IDEA-14).
 * The plugin view registry and layout restore re-apply "Explorer", so the label is pinned on every update.
 */
export const pinProjectLabel = (container: ViewContainer): void => {
    const setTitleOptions = container.setTitleOptions.bind(container);
    container.setTitleOptions = (options: ViewContainerTitleOptions | undefined) =>
        setTitleOptions({ ...(options ?? EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS), label: PROJECT_VIEW_LABEL });
    container.setTitleOptions(EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS);
};
