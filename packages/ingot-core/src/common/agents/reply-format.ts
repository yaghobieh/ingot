/** Agent reply structure helpers (IDEA-104): keep model replies readable even when a model ignores line breaks. */

/** A flow line ("A → B → C") becomes a row of step chips when it has at least this many steps. */
export const FLOW_MIN_STEPS = 3;
/** Steps longer than this are prose, not a flow. */
export const FLOW_MAX_STEP = 48;
/** Inline code in a table cell that is a short upper-case word is shown as a status badge. */
export const BADGE_PATTERN = /^[A-Z]{3,12}$/;

const FLOW_SPLIT = /\s+(?:→|->)\s+/;
const INLINE_BULLET = /\s+-\s+(?=\*\*|`)/g;

/** The steps of a one-line flow, or undefined when the line is not a flow. */
export const flowSteps = (line: string): string[] | undefined => {
    const text = line.trim();
    if (!text || text.includes('\n')) {
        return undefined;
    }
    const steps = text.split(FLOW_SPLIT).map(s => s.trim());
    return steps.length >= FLOW_MIN_STEPS && steps.every(s => s.length > 0 && s.length <= FLOW_MAX_STEP) ? steps : undefined;
};

/**
 * Splits a bullet list that a model squashed into one paragraph (" - **a** … - **b** …") back into lines.
 * Only lines with two or more such bullets outside code fences are touched.
 */
export const normalizeReply = (text: string): string => {
    let fenced = false;
    return text.split('\n').map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            return line;
        }
        if (fenced || (line.match(INLINE_BULLET) ?? []).length < 2) {
            return line;
        }
        const parts = line.split(INLINE_BULLET);
        const [lead, ...items] = parts;
        return [lead.trim(), '', ...items.map(item => `- ${item.trim()}`)].filter((p, i) => i > 0 || p).join('\n');
    }).join('\n');
};
