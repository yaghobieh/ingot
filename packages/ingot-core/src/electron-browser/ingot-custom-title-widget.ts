import { injectable } from '@theia/core/shared/inversify';
import { CustomTitleWidget } from '@theia/core/lib/electron-browser/menu/electron-menu-contribution';
import { MAIN_TOOLBAR_ID } from '../browser/shell/ingot-shell.consts';
import { computeTitleSlot } from '../common/titlebar/title-slot.utils';

const LEFT_GROUP = '.ingot-tb-left';
const RIGHT_GROUP = '.ingot-tb-right';

/**
 * IDEA-169: Theia centres the window title between its menu bar and the window controls only, so on Windows/Linux
 * it was drawn over Ingot's main toolbar (Open Project, Version Control, Current File) in small windows. Here the
 * title lives in the real gap between the toolbar's left and right groups: centred when it fits, ellipsized when it
 * is tight, hidden when there is no room. It re-measures whenever either group changes size (branch, project, run
 * configuration labels) as well as on window resize and title changes.
 */
@injectable()
export class IngotCustomTitleWidget extends CustomTitleWidget {

    protected observed?: Element;
    protected readonly resizeObserver = new ResizeObserver(() => this.adjustTitleToCenter());

    protected override adjustTitleToCenter(): void {
        const toolbar = document.getElementById(MAIN_TOOLBAR_ID);
        const left = toolbar?.querySelector(LEFT_GROUP);
        const right = toolbar?.querySelector(RIGHT_GROUP);
        const panel = this.node.parentElement;
        if (!toolbar || !left || !right || !panel) {
            super.adjustTitleToCenter();
            return;
        }
        this.observeToolbar(toolbar, left, right);
        const style = this.node.style;
        style.maxWidth = '';
        const origin = panel.getBoundingClientRect().left;
        const slot = computeTitleSlot({
            leftEdge: left.getBoundingClientRect().right - origin,
            rightEdge: right.getBoundingClientRect().left - origin,
            panelWidth: panel.clientWidth,
            titleWidth: this.node.scrollWidth
        });
        style.left = `${slot.left}px`;
        style.maxWidth = `${slot.maxWidth}px`;
        this.node.classList.add('relative');
        this.node.classList.toggle('hidden', slot.hidden);
    }

    protected observeToolbar(toolbar: Element, left: Element, right: Element): void {
        if (this.observed === toolbar) {
            return;
        }
        this.resizeObserver.disconnect();
        this.observed = toolbar;
        this.resizeObserver.observe(left);
        this.resizeObserver.observe(right);
    }

    override dispose(): void {
        this.resizeObserver.disconnect();
        super.dispose();
    }
}
