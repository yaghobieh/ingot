import { AGENT_ICON_COPY_FRONT, AGENT_ICON_PATHS, AGENT_ICON_SIZE, AGENT_ICON_STROKE, AGENT_ICON_VIEWBOX } from './agent-icons.consts';

/** The Copy icon as markup, for code blocks rendered from markdown. */
export const copyIconHtml = (): string => {
    const f = AGENT_ICON_COPY_FRONT;
    return `<svg class="ingot-agent-icon" width="${AGENT_ICON_SIZE.copy}" height="${AGENT_ICON_SIZE.copy}" viewBox="${AGENT_ICON_VIEWBOX}" fill="none" stroke="currentColor"`
        + ` stroke-width="${AGENT_ICON_STROKE.thin}" stroke-linejoin="round" aria-hidden="true">`
        + `<rect x="${f.x}" y="${f.y}" width="${f.size}" height="${f.size}" rx="${f.radius}"></rect><path d="${AGENT_ICON_PATHS.copyBack}"></path></svg>`;
};
