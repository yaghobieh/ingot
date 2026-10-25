// IDEA-63 v3: the Ingot mark is just the </> glyph in brand blue with a soft light-blue glow (blue variant, IDEA-63) (no tile, no bar).
// `markSvg(t)` draws one animation frame: t=0 the brackets sit together, they open apart, "..." types in,
// then the slash slides in and a shimmer sweeps across; t=1 is the static master icon.
export const BRAND = { blue: '#3B6FD9', blueLight: '#8DB2FF', blueDeep: '#2A4FB0', glow: '#5E8FFF', shine: '#E3EEFF', gold: '#D9A04E', navy: '#1B2647' };

const clamp = v => Math.min(1, Math.max(0, v));
const ease = v => 1 - Math.pow(1 - clamp(v), 3);
const seg = (t, a, b) => ease((t - a) / (b - a));

/** Final geometry on a 1024 canvas. */
const LEFT = 'M336 300 L124 512 L336 724';
const RIGHT = 'M688 300 L900 512 L688 724';
const SLASH = { x1: 578, y1: 250, x2: 446, y2: 774 };

/**
 * @param {number} t 0..1 animation progress (1 = static icon)
 * @param {{ small?: boolean, background?: string }} options small = 16–32 px art (thicker, no glow)
 */
export const markSvg = (t = 1, { small = false, background } = {}) => {
    const open = seg(t, 0.0, 0.35);        // brackets move apart
    const dots = t < 0.35 ? 0 : t < 0.75 ? seg(t, 0.35, 0.6) : 1 - seg(t, 0.72, 0.82);
    const slash = seg(t, 0.7, 0.9);         // slash slides in
    const shimmer = seg(t, 0.82, 1);        // light sweep at the end
    const gap = (1 - open) * 150;           // brackets start 150 px closer to the centre
    const width = small ? 128 : 92;
    const outline = width + (small ? 26 : 18);
    const dotOpacity = (i) => clamp(dots * 3 - i);
    const slashDy = (1 - slash) * -260;
    const glow = small ? '' : `<g filter="url(#glow)" opacity="${0.55 + 0.25 * Math.sin(Math.PI * shimmer)}">
      <path d="${LEFT}" transform="translate(${gap} 0)"/><path d="${RIGHT}" transform="translate(${-gap} 0)"/>
      ${slash > 0 ? `<line x1="${SLASH.x1}" y1="${SLASH.y1 + slashDy}" x2="${SLASH.x2}" y2="${SLASH.y2 + slashDy}" opacity="${slash}"/>` : ''}
    </g>`;
    const shimmerX = -300 + shimmer * 1600;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><title>Ingot app icon</title>
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.blueLight}"/><stop offset=".5" stop-color="${BRAND.blue}"/><stop offset="1" stop-color="${BRAND.blueDeep}"/></linearGradient>
    <linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="${shimmerX - 160}" y1="0" x2="${shimmerX + 160}" y2="300">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="${BRAND.shine}" stop-opacity="${shimmer > 0 && shimmer < 1 ? 0.95 : 0}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>
  </defs>
  ${background ? `<rect width="1024" height="1024" fill="${background}"/>` : ''}
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="${BRAND.glow}" stroke-width="${width + 24}">${glow}</g>
    <g stroke="${BRAND.navy}" stroke-opacity=".92" stroke-width="${outline}">
      <path d="${LEFT}" transform="translate(${gap} 0)"/><path d="${RIGHT}" transform="translate(${-gap} 0)"/>
      ${slash > 0 ? `<line x1="${SLASH.x1}" y1="${SLASH.y1 + slashDy}" x2="${SLASH.x2}" y2="${SLASH.y2 + slashDy}" opacity="${slash}"/>` : ''}
    </g>
    <g stroke="url(#fill)" stroke-width="${width}">
      <path d="${LEFT}" transform="translate(${gap} 0)"/><path d="${RIGHT}" transform="translate(${-gap} 0)"/>
      ${slash > 0 ? `<line x1="${SLASH.x1}" y1="${SLASH.y1 + slashDy}" x2="${SLASH.x2}" y2="${SLASH.y2 + slashDy}" opacity="${slash}"/>` : ''}
    </g>
    ${shimmer > 0 && shimmer < 1 ? `<g stroke="url(#shine)" stroke-width="${width * 0.55}">
      <path d="${LEFT}"/><path d="${RIGHT}"/><line x1="${SLASH.x1}" y1="${SLASH.y1}" x2="${SLASH.x2}" y2="${SLASH.y2}"/></g>` : ''}
  </g>
  ${dots > 0 ? [0, 1, 2].map(i => `<circle cx="${452 + i * 60}" cy="512" r="30" fill="${i === 1 ? BRAND.shine : BRAND.blueLight}" stroke="${BRAND.navy}" stroke-width="10" opacity="${dotOpacity(i)}"/>`).join('') : ''}
</svg>`;
};
