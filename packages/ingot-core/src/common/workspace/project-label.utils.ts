/** The file tree header text (IDEA-93): "Explorer: ingot (Workspace)" → "ingot"; just "Explorer" → `fallback`. */
export const projectHeaderLabel = (label: string, explorerLabel: string, fallback: string): string => {
    if (!label.startsWith(explorerLabel)) {
        return label;
    }
    const name = label.slice(explorerLabel.length).replace(/^\s*:\s*/, '').replace(/\s*\(Workspace\)\s*$/, '').trim();
    return name || fallback;
};
