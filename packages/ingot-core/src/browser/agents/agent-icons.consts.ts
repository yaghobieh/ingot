/** Line icons of the agent panel, drawn on a 16×16 grid (same art as the panel design). */
export const AGENT_ICON_VIEWBOX = '0 0 16 16';

export const AGENT_ICON_SIZE = {
    header: 16,
    check: 14,
    chevron: 12,
    caret: 10,
    copy: 12,
    send: 14
} as const;

export const AGENT_ICON_STROKE = { thin: 1.5, bold: 2 } as const;

export const AGENT_ICON_PATHS = {
    check: 'M3 8.5l3.2 3.2L13 5',
    plus: 'M8 3v10M3 8h10',
    clockHands: 'M8 5v3.2l2 1.3',
    chevronDown: 'M4 6l4 4 4-4',
    chevronRight: 'M6 4l4 4-4 4',
    copyBack: 'M10.5 3.5v-.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5',
    attach: 'M12.5 7.5l-4.6 4.6a2.5 2.5 0 0 1-3.5-3.5l5-5a1.7 1.7 0 0 1 2.4 2.4l-5 5a.9.9 0 0 1-1.3-1.3L9.3 5.5',
    send: 'M8 13V3M3.5 7.5L8 3l4.5 4.5'
} as const;

/** Clock face of the History icon and the three dots of More. */
export const AGENT_ICON_CLOCK = { cx: 8, cy: 8, r: 5.5 } as const;
export const AGENT_ICON_DOTS = { xs: [3.5, 8, 12.5], cy: 8, r: 1.2 } as const;
/** Front sheet of the Copy icon. */
export const AGENT_ICON_COPY_FRONT = { x: 5.5, y: 5.5, size: 8, radius: 1.5 } as const;
