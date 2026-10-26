/** IDEA-169: where the window title may sit in the custom title bar without covering the main toolbar. */

export interface TitleSlotInput {
    /** Right edge of the last left-hand toolbar control, relative to the top panel. */
    readonly leftEdge: number;
    /** Left edge of the first right-hand toolbar control, relative to the top panel. */
    readonly rightEdge: number;
    readonly panelWidth: number;
    /** The title's natural (unclipped) width. */
    readonly titleWidth: number;
}

export interface TitleSlot {
    readonly hidden: boolean;
    /** Left position of the title box, relative to the top panel. */
    readonly left: number;
    /** Width the title may take; longer titles are ellipsized. */
    readonly maxWidth: number;
}

/** Breathing room on each side of the title. */
export const TITLE_SLOT_MARGIN = 16;
/** Below this the title is hidden rather than shown as a few letters and an ellipsis. */
export const TITLE_SLOT_MIN_WIDTH = 96;

/**
 * Centre the title in the window when it fits between the toolbar groups; otherwise centre it in the free gap and
 * ellipsize it; hide it when the gap is too small to be useful.
 */
export function computeTitleSlot(input: TitleSlotInput, margin = TITLE_SLOT_MARGIN, minWidth = TITLE_SLOT_MIN_WIDTH): TitleSlot {
    const start = input.leftEdge + margin;
    const end = input.rightEdge - margin;
    const room = end - start;
    if (room < minWidth) {
        return { hidden: true, left: start, maxWidth: 0 };
    }
    const width = Math.min(input.titleWidth, room);
    const centred = (input.panelWidth - width) / 2;
    const left = centred >= start && centred + width <= end ? centred : start + (room - width) / 2;
    return { hidden: false, left: Math.round(left), maxWidth: Math.floor(room) };
}
