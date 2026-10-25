import type { ContextChip } from './context-chips';

/** An image pasted, dropped or attached in the composer (IDEA-98). `data` is base64 without the data: prefix. */
export interface ImageChip {
    readonly id: string;
    readonly name: string;
    readonly mediaType: string;
    readonly data: string;
}

/** What the inline composer holds, in order: text with code and image chips between it. */
export type ComposerPart =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'code'; readonly chip: ContextChip }
    | { readonly kind: 'image'; readonly image: ImageChip };

/** A sent user message as shown in the chat: the same order, without file contents. */
export type SentPart =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'code'; readonly label: string; readonly path: string }
    | { readonly kind: 'image'; readonly id: string; readonly name: string };

export interface ComposedMessage {
    /** Visible text with chips as `[a.ts (3-5)]` / `[image: shot.png]`. */
    readonly text: string;
    /** What the model reads: the text in order with each chip's lines inlined where it sits. */
    readonly expanded: string;
    readonly chips: readonly ContextChip[];
    readonly images: readonly ImageChip[];
    readonly parts: readonly SentPart[];
}
