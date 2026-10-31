import { chipLabel } from './context-chips';
import type { ComposedMessage, ComposerPart, SentPart } from './composer-parts.types';

/** Joins neighbouring text parts and drops empty ones. */
export const normalizeParts = (parts: readonly ComposerPart[]): ComposerPart[] => {
    const out: ComposerPart[] = [];
    for (const part of parts) {
        const last = out[out.length - 1];
        if (part.kind === 'text') {
            if (!part.text) {
                continue;
            }
            if (last?.kind === 'text') {
                out[out.length - 1] = { kind: 'text', text: last.text + part.text };
                continue;
            }
        }
        out.push(part);
    }
    return out;
};

const tidy = (text: string): string => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const codeBlock = (part: Extract<ComposerPart, { kind: 'code' }>): string => {
    const { chip } = part;
    const what = chip.rule ? `Project rule ${chip.rule} (${chip.path}), follow it for this request` : chip.whole ? `File ${chip.path}` : `Selected code from ${chip.path} (lines ${chip.start}-${chip.end})`;
    return `\n[${chipLabel(chip)}] ${what}:\n\`\`\`\n${chip.text.replace(/\n$/, '')}\n\`\`\`\n`;
};

/**
 * Serializes the composer for sending (IDEA-98). Chips stay where the user put them: the model reads
 * "explain [a.ts (3-5)] … then compare with [a.ts (9-12)]" with each chip's lines inlined at that spot.
 */
export const composeParts = (input: readonly ComposerPart[]): ComposedMessage => {
    const parts = normalizeParts(input);
    let imageIndex = 0;
    const visible = parts.map(p => p.kind === 'text' ? p.text : p.kind === 'code' ? `[${chipLabel(p.chip)}]` : `[image: ${p.image.name}]`);
    const expanded = parts.map(p => {
        if (p.kind === 'text') {
            return p.text;
        }
        if (p.kind === 'code') {
            return codeBlock(p);
        }
        imageIndex++;
        return ` [image ${imageIndex}: ${p.image.name}] `;
    });
    const sent: SentPart[] = parts.map(p => p.kind === 'text' ? { kind: 'text', text: p.text }
        : p.kind === 'code' ? { kind: 'code', label: chipLabel(p.chip), path: p.chip.path }
            : { kind: 'image', id: p.image.id, name: p.image.name });
    return {
        text: tidy(visible.join('').replace(/[ \t]{2,}/g, ' ')),
        expanded: tidy(expanded.join('').replace(/ {2,}/g, ' ')),
        chips: parts.flatMap(p => p.kind === 'code' ? [p.chip] : []),
        images: parts.flatMap(p => p.kind === 'image' ? [p.image] : []),
        parts: sent
    };
};

/** True when there is nothing to send (no text, no chips). */
export const partsEmpty = (parts: readonly ComposerPart[]): boolean =>
    parts.every(p => p.kind === 'text' && !p.text.trim());

/** Plain text of the composer (chips left out), e.g. to detect a `/command`. */
export const partsText = (parts: readonly ComposerPart[]): string =>
    parts.map(p => p.kind === 'text' ? p.text : '').join('');
