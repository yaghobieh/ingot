/** IDEA-183: a "Made with" trailer on commits written by the Ingot agent, Commit with AI or Zaprex. */
export const MADE_WITH_PREF = 'ingot.commit.madeWithTrailer';

export const MADE_WITH = {
    ingot: 'Made with [Ingot](https://ingot-portal.vercel.app)',
    zaprex: 'Made with [Zaprex](https://zaprex.dev)'
} as const;

export type MadeWithSource = keyof typeof MADE_WITH;

const HAS_TRAILER = /^Made with \[(Ingot|Zaprex)\]\(/m;
/** `Key: value` lines (Signed-off-by, Co-authored-by …) form git's trailer block. */
const TRAILER_LINE = /^[A-Za-z][\w-]*: \S/;

/** Adds the trailer once, at the end: inside an existing trailer block, else after a blank line. */
export const withMadeWith = (message: string, source: MadeWithSource): string => {
    const body = message.replace(/\s+$/, '');
    if (!body.trim() || HAS_TRAILER.test(body)) {
        return message;
    }
    const lines = body.split('\n');
    const last = lines[lines.length - 1];
    const inTrailerBlock = lines.length > 2 && TRAILER_LINE.test(last) && lines.slice(0, -1).some(l => !l.trim());
    return `${body}${inTrailerBlock ? '\n' : '\n\n'}${MADE_WITH[source]}\n`;
};
