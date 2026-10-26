/* Vendored from the Zaprex animated mascot (zaprex-assets/animated/zaprex-mascot.ts). Keep in sync; do not edit by hand. */
/**
 * Zaprex animated mascot: a layered SVG (raster body + arm from the official artwork, vector eyes, lightning and
 * effects) with six states. Framework-free so the site, portal and IDE can all use it.
 *
 *   el.innerHTML = zaprexMascotSvg({ body: "/mascot/zaprex-body-512.webp", arm: "/mascot/zaprex-arm-512.webp" });
 *   el.querySelector("svg").dataset.state = "working"; // idle | thinking | working | approval | done | error
 *
 * Motion stops automatically under prefers-reduced-motion (each state keeps a readable static pose).
 */
export type ZaprexState = "idle" | "thinking" | "working" | "approval" | "done" | "error";
export const ZAPREX_STATES: ZaprexState[] = ["idle", "thinking", "working", "approval", "done", "error"];

export const ZAPREX_MASCOT_CSS = `
.zx-m{overflow:visible}
.zx-m *{transform-box:view-box}
.zx-m .zx-rig{transform-origin:380px 715px;animation:zx-breathe 3.6s ease-in-out infinite}
.zx-m .zx-arm{transform-origin:552px 494px;transition:transform .45s cubic-bezier(.3,1.6,.5,1)}
.zx-m .zx-lid{transform:translateY(-80px);animation:zx-blink 4.8s infinite}
.zx-m .zx-lowlid{transform:translateY(80px);transition:transform .35s ease}
.zx-m .zx-pupil{transition:transform .35s ease}
.zx-m .zx-bolt{fill:none;stroke-linecap:round;stroke-linejoin:round}
.zx-m .zx-bolt-glow{stroke:#5fb4ff;stroke-width:14;opacity:0;filter:url(#ZXID-blur)}
.zx-m .zx-bolt-core{stroke:#dff2ff;stroke-width:3.2;opacity:0;stroke-dasharray:60 520}
.zx-m .zx-fx{opacity:0;transition:opacity .3s ease}
.zx-m .zx-spark{transform-origin:center;transform-box:fill-box}
.zx-m .zx-tear{opacity:0}
.zx-m .zx-rig image{transition:filter .4s ease}
/* thinking: looks around, lightning flickers, thought dots */
.zx-m[data-state=thinking] .zx-pupil{animation:zx-look 3.2s ease-in-out infinite}
.zx-m[data-state=thinking] .zx-bolt-glow{animation:zx-flicker 1.3s steps(1) infinite}
.zx-m[data-state=thinking] .zx-think{opacity:1}
.zx-m[data-state=thinking] .zx-think circle{animation:zx-dot 1.2s ease-in-out infinite}
.zx-m[data-state=thinking] .zx-think circle:nth-child(2){animation-delay:.2s}
.zx-m[data-state=thinking] .zx-think circle:nth-child(3){animation-delay:.4s}
.zx-m[data-state=thinking] .zx-rig{animation:zx-tilt 3.2s ease-in-out infinite}
/* working: lightning pulses along the spikes */
.zx-m[data-state=working] .zx-bolt-glow{opacity:.55;animation:zx-glow .9s ease-in-out infinite}
.zx-m[data-state=working] .zx-bolt-core{opacity:1;animation:zx-run 1.1s linear infinite}
.zx-m[data-state=working] .zx-rig{animation:zx-breathe 1.2s ease-in-out infinite}
.zx-m[data-state=working] .zx-pupil{transform:translate(6px,4px)}
/* approval: raises a claw and waits */
.zx-m[data-state=approval] .zx-arm{transform:rotate(-112deg);animation:zx-wave 1.4s ease-in-out .45s infinite}
.zx-m[data-state=approval] .zx-ask{opacity:1}
.zx-m[data-state=approval] .zx-ask .zx-ring{animation:zx-ping 1.6s ease-out infinite}
.zx-m[data-state=approval] .zx-pupil{transform:translate(8px,-6px)}
/* done: happy roar with sparkles */
.zx-m[data-state=done] .zx-rig{animation:zx-roar 1.6s ease-in-out infinite}
.zx-m[data-state=done] .zx-lowlid{transform:translateY(-8px)}
.zx-m[data-state=done] .zx-lid{animation:none;transform:translateY(-80px)}
.zx-m[data-state=done] .zx-sparkles{opacity:1}
.zx-m[data-state=done] .zx-spark{animation:zx-twinkle 1.6s ease-in-out infinite}
.zx-m[data-state=done] .zx-spark:nth-child(2){animation-delay:.3s}
.zx-m[data-state=done] .zx-spark:nth-child(3){animation-delay:.6s}
.zx-m[data-state=done] .zx-spark:nth-child(4){animation-delay:.9s}
.zx-m[data-state=done] .zx-bolt-glow{opacity:.7}
/* error: sad, droopy lids, a tear, lightning out */
.zx-m[data-state=error] .zx-rig{animation:none;transform:rotate(3deg) translateY(10px)}
.zx-m[data-state=error] .zx-lid{animation:none;transform:translateY(-46px) rotate(-16deg)}
.zx-m[data-state=error] .zx-pupil{transform:translate(-4px,10px)}
.zx-m[data-state=error] .zx-rig image{filter:saturate(.35) brightness(.82)}
.zx-m[data-state=error] .zx-tear{animation:zx-tear 2.2s ease-in infinite}
@keyframes zx-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.008,1.018)}}
@keyframes zx-tilt{0%,100%{transform:rotate(0)}30%{transform:rotate(-2.2deg)}70%{transform:rotate(1.6deg)}}
@keyframes zx-roar{0%,100%{transform:translateY(0) rotate(0)}35%{transform:translateY(-26px) rotate(-4deg)}55%{transform:translateY(0) rotate(-1deg)}}
@keyframes zx-blink{0%,92%,100%{transform:translateY(-80px)}95%{transform:translateY(0)}}
@keyframes zx-look{0%,100%{transform:translate(0,0)}20%{transform:translate(-11px,-6px)}45%{transform:translate(-11px,-6px)}60%{transform:translate(10px,-9px)}85%{transform:translate(10px,-9px)}}
@keyframes zx-flicker{0%{opacity:.6}12%{opacity:0}20%{opacity:.75}31%{opacity:.1}55%{opacity:.5}70%{opacity:0}}
@keyframes zx-glow{0%,100%{opacity:.35}50%{opacity:.85}}
@keyframes zx-run{from{stroke-dashoffset:580}to{stroke-dashoffset:0}}
@keyframes zx-wave{0%,100%{transform:rotate(-112deg)}50%{transform:rotate(-94deg)}}
@keyframes zx-ping{0%{r:18;opacity:.9}100%{r:44;opacity:0}}
@keyframes zx-dot{0%,100%{transform:translateY(0);opacity:.45}50%{transform:translateY(-10px);opacity:1}}
@keyframes zx-twinkle{0%,100%{transform:scale(.3) rotate(0);opacity:0}40%{transform:scale(1.1) rotate(25deg);opacity:1}70%{transform:scale(.9) rotate(40deg);opacity:.9}}
@keyframes zx-tear{0%{transform:translateY(0);opacity:0}15%{opacity:.95}80%{transform:translateY(42px);opacity:.9}100%{transform:translateY(52px);opacity:0}}
@media (prefers-reduced-motion:reduce){.zx-m *,.zx-m{animation:none!important;transition:none!important}
.zx-m[data-state=working] .zx-bolt-core{stroke-dasharray:none;opacity:.8}
.zx-m[data-state=thinking] .zx-bolt-glow{opacity:.45}
.zx-m[data-state=done] .zx-spark{opacity:1;transform:scale(1)}
.zx-m[data-state=error] .zx-tear{opacity:.9;transform:translateY(14px)}}
`;

const BOLTS = [
  "M408 150 L395 172 L386 190 L393 205 L379 226 L373 252 L369 290 L381 320 L372 345 L395 362 L410 410",
  "M362 300 L331 316 L311 336 L286 330 L262 346 L240 356 L224 372 L210 401 L200 431 L215 461 L209 491 L229 521 L227 551",
  "M210 401 L186 416 L166 431 L150 456 L128 446 L110 466 L90 446 L70 441 L56 411 L45 401",
  "M300 336 L286 381 L306 401 L300 431 L320 451",
];

export type ZaprexMascotOptions = { body: string; arm: string; state?: ZaprexState; id?: string; title?: string; className?: string };

let counter = 0;

/** Returns the SVG markup. `body`/`arm` are URLs (or data URIs) of the two artwork layers. */
export function zaprexMascotSvg({ body, arm, state = "idle", id, title = "Zaprex", className = "" }: ZaprexMascotOptions): string {
  const p = id ?? `zx${(counter += 1)}`;
  const bolts = BOLTS.map(d => `<path class="zx-bolt zx-bolt-glow" d="${d}"/><path class="zx-bolt zx-bolt-core" d="${d}"/>`).join("");
  const star = (x: number, y: number, s: number) =>
    `<path class="zx-spark" d="M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y} L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y} L${x - s * 0.28} ${y - s * 0.28} Z" fill="#f4c66d"/>`;
  return `<svg class="zx-m ${className}" data-state="${state}" viewBox="0 0 754 754" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<title>${title}</title>
<style>${ZAPREX_MASCOT_CSS.replaceAll("ZXID", p)}</style>
<defs>
<filter id="${p}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
<radialGradient id="${p}-iris" cx="45%" cy="62%" r="60%"><stop offset="0" stop-color="#7fd0ff"/><stop offset=".45" stop-color="#2479e8"/><stop offset="1" stop-color="#0a2768"/></radialGradient>
<radialGradient id="${p}-sclera" cx="35%" cy="40%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d4ec"/></radialGradient>
<clipPath id="${p}-eye"><ellipse cx="486" cy="181" rx="33" ry="35"/></clipPath>
</defs>
<g class="zx-rig">
  <image href="${body}" x="0" y="0" width="754" height="754"/>
  <g class="zx-arm"><image href="${arm}" x="0" y="0" width="754" height="754"/></g>
  <g style="mix-blend-mode:screen">${bolts}</g>
  <g class="zx-eye" clip-path="url(#${p}-eye)">
    <ellipse cx="486" cy="181" rx="33" ry="35" fill="url(#${p}-sclera)"/>
    <g class="zx-pupil">
      <circle cx="494" cy="185" r="25" fill="url(#${p}-iris)"/>
      <circle cx="495" cy="184" r="15.5" fill="#050a1f"/>
      <circle cx="481" cy="168" r="5.5" fill="#fff"/><circle cx="501" cy="170" r="6.5" fill="#fff"/>
    </g>
    <rect class="zx-lid" x="440" y="140" width="95" height="82" fill="#1f2c5e"/>
    <ellipse class="zx-lowlid" cx="486" cy="236" rx="52" ry="42" fill="#1f2c5e"/>
    <ellipse cx="486" cy="181" rx="33" ry="35" fill="none" stroke="#0d1532" stroke-width="3"/>
  </g>
  <path class="zx-tear" d="M478 214 q7 12 0 18 q-7 -6 0 -18 z" fill="#8fd0ff"/>
</g>
<g class="zx-fx zx-think" fill="#8fb1ff"><circle cx="600" cy="92" r="9"/><circle cx="630" cy="72" r="11"/><circle cx="664" cy="48" r="13"/></g>
<g class="zx-fx zx-ask"><circle class="zx-ring" cx="700" cy="66" r="18" fill="none" stroke="#d9a04e" stroke-width="4"/><circle cx="700" cy="66" r="16" fill="#d9a04e"/><text x="700" y="77" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="30" fill="#1b2647">!</text></g>
<g class="zx-fx zx-sparkles">${star(620, 70, 26)}${star(700, 160, 18)}${star(330, 70, 20)}${star(690, 330, 14)}</g>
</svg>`;
}
