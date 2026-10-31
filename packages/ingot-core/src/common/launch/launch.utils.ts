import { LAUNCH_FALLBACK } from './launch.consts';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;
const HEX_ALPHA_LENGTH = 9;

/** A solid color the launch window can use (hex or rgb()/rgba() as `getComputedStyle` reports it); transparent ones are not. */
export const isLaunchColor = (value: string | null | undefined): value is string => {
    const color = value?.trim() ?? '';
    if (HEX_COLOR.test(color)) {
        return color.length !== HEX_ALPHA_LENGTH || !color.toLowerCase().endsWith('00');
    }
    const rgb = RGB_COLOR.exec(color);
    return !!rgb && (rgb[1] === undefined || Number(rgb[1]) > 0);
};

/** The saved theme background, else the Ingot Light / Dark canvas for the OS appearance. */
export const launchBackground = (saved: string | null | undefined, dark: boolean): string =>
    isLaunchColor(saved) ? saved.trim() : dark ? LAUNCH_FALLBACK.dark : LAUNCH_FALLBACK.light;
