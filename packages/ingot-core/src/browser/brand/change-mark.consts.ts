/** IDEA-102: palette of the blue </> mark on code-change blocks while an edit streams. */
export const CHANGE_MARK_TONE = {
    stops: ['#9CC0FF', '#3B7BF0', '#2350B0'],
    glow: '#3B7BF0',
    outline: '#0E1A3A',
    shine: '#E3EEFF',
    dots: ['#9CC0FF', '#FFFFFF', '#9CC0FF']
} as const;

export const CHANGE_MARK_LEFT = 'M336 300 L124 512 L336 724';
export const CHANGE_MARK_RIGHT = 'M688 300 L900 512 L688 724';
export const CHANGE_MARK_DEFAULT_SIZE = 16;
