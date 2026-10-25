import { ViewContainer } from '@theia/core/lib/browser';
import { EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS } from '@theia/navigator/lib/browser/navigator-widget-factory';
import { PROJECT_VIEW_LABEL } from './navigator.consts';
import { projectHeaderLabel } from '../../common/workspace/project-label.utils';

export { PROJECT_VIEW_LABEL };

/** The file tree header shows just the project name (IDEA-93); with no folder open it reads "Project". */
export const toProjectLabel = (label: string, explorerLabel = EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS.label): string =>
    projectHeaderLabel(label, explorerLabel, PROJECT_VIEW_LABEL);

/**
 * Naming: the file tree tool window is labelled with the project name (IDEA-14, IDEA-93).
 * Theia recomputes the container title (plugin views, layout restore, multi-root), so the label is
 * rewritten after every recomputation without changing the title options Theia compares against.
 */
export const pinProjectLabel = (container: ViewContainer, projectName: () => string | undefined = () => undefined): () => void => {
    const target = container as unknown as { updateTitle(): void };
    const updateTitle = target.updateTitle.bind(container);
    target.updateTitle = () => {
        updateTitle();
        const label = toProjectLabel(container.title.label);
        // A single folder: Theia's title is just "Explorer", so take the folder name.
        container.title.label = label === PROJECT_VIEW_LABEL ? projectName() || PROJECT_VIEW_LABEL : label;
    };
    target.updateTitle();
    return () => target.updateTitle();
};
