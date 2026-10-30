import { fileIconClass } from '../../common/icons/file-icon-map';
import { chipLabel, chipPreview, type ContextChip } from '../../common/agents/context-chips';
import type { ComposerPart, ImageChip } from '../../common/agents/composer-parts.types';
import { normalizeParts } from '../../common/agents/composer-parts';
import { CHIP_ATTR, IMAGE_MIME, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from './inline-composer.consts';

export interface InlineComposerHandlers {
    onChange(): void;
    openCode(chip: ContextChip): void;
    openImage(image: ImageChip): void;
    /** Files or project-tree items dropped on the composer (the caret is already at the drop point). */
    drop(data: DataTransfer): boolean;
}

type Token = { kind: 'code'; chip: ContextChip } | { kind: 'image'; image: ImageChip };

let counter = 0;
const nextId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Reads an image file as base64, scaling it down when its longest side is over MAX_IMAGE_SIDE. */
export const readImage = async (file: Blob, name: string): Promise<ImageChip | undefined> => {
    if (!IMAGE_MIME.test(file.type)) {
        return undefined;
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('image')); img.src = url; });
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        let mediaType = file.type;
        let data: string;
        if (scale < 1 || file.type === 'image/gif') {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            mediaType = 'image/png';
            data = canvas.toDataURL(mediaType).split(',')[1];
        } else {
            data = await new Promise<string>(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
                reader.readAsDataURL(file);
            });
        }
        return data.length * 0.75 > MAX_IMAGE_BYTES ? undefined : { id: nextId(), name, mediaType, data };
    } catch {
        return undefined;
    } finally {
        URL.revokeObjectURL(url);
    }
};

/**
 * The chat composer as an inline editor (IDEA-98): text with atomic code and image chips between it, in order.
 * Chips are non-editable spans; Backspace/Delete remove them whole, arrows step over them, hover previews the lines.
 */
export class InlineComposer {

    readonly tokens = new Map<string, Token>();
    protected savedRange?: Range;
    protected preview?: HTMLElement;

    constructor(readonly el: HTMLElement, protected readonly handlers: InlineComposerHandlers) {
        el.contentEditable = 'true';
        el.setAttribute('role', 'textbox');
        el.setAttribute('aria-multiline', 'true');
        el.addEventListener('keydown', e => this.onKeyDown(e));
        el.addEventListener('input', () => this.changed());
        el.addEventListener('blur', () => this.saveRange());
        el.addEventListener('keyup', () => this.saveRange());
        el.addEventListener('mouseup', () => this.saveRange());
        el.addEventListener('mouseover', e => this.onHover(e));
        el.addEventListener('mouseout', e => { if (!(e.relatedTarget instanceof Node && this.chipOf(e.relatedTarget))) { this.hidePreview(); } });
        el.addEventListener('click', e => this.onClick(e));
        // The workbench marks every drag over the document as "no drop" (dropEffect none); claim drags over the
        // composer first, or the drop never happens in the desktop app.
        const accept = (e: DragEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            el.classList.add('drop-target');
        };
        el.addEventListener('dragenter', accept);
        el.addEventListener('dragover', accept);
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', e => {
            el.classList.remove('drop-target');
            if (!e.dataTransfer) {
                return;
            }
            e.stopPropagation();
            this.caretAt(e.clientX, e.clientY);
            if (handlers.drop(e.dataTransfer)) {
                e.preventDefault();
            }
        });
    }

    get parts(): ComposerPart[] {
        const parts: ComposerPart[] = [];
        const walk = (node: Node, top: boolean): void => {
            node.childNodes.forEach((child, i) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    parts.push({ kind: 'text', text: (child.textContent ?? '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ') });
                    return;
                }
                if (!(child instanceof HTMLElement)) {
                    return;
                }
                const id = child.getAttribute(CHIP_ATTR);
                const token = id ? this.tokens.get(id) : undefined;
                if (token) {
                    parts.push(token.kind === 'code' ? { kind: 'code', chip: token.chip } : { kind: 'image', image: token.image });
                } else if (child.tagName === 'BR') {
                    parts.push({ kind: 'text', text: '\n' });
                } else {
                    // Chromium wraps new lines in <div>s inside contenteditable.
                    if (top && i > 0 && (child.tagName === 'DIV' || child.tagName === 'P')) {
                        parts.push({ kind: 'text', text: '\n' });
                    }
                    walk(child, false);
                }
            });
        };
        walk(this.el, true);
        const normalized = normalizeParts(parts);
        const last = normalized[normalized.length - 1];
        if (last?.kind === 'text' && last.text.endsWith('\n')) {
            normalized[normalized.length - 1] = { kind: 'text', text: last.text.replace(/\n+$/, '') };
        }
        return normalized;
    }

    get codeChips(): ContextChip[] {
        return [...this.tokens.values()].flatMap(t => t.kind === 'code' && this.el.querySelector(`[${CHIP_ATTR}="${t.chip.id}"]`) ? [t.chip] : []);
    }

    /** Plain text, chips left out. */
    get text(): string {
        return this.parts.map(p => p.kind === 'text' ? p.text : '').join('');
    }

    get empty(): boolean {
        return this.parts.every(p => p.kind === 'text' && !p.text.trim());
    }

    focus(): void {
        this.el.focus();
        this.restoreRange();
    }

    clear(): void {
        this.el.replaceChildren();
        this.tokens.clear();
        this.hidePreview();
        this.changed();
    }

    /** Replaces everything with plain text (slash commands, @ context) and puts the caret at the end. */
    setText(text: string): void {
        this.el.replaceChildren(document.createTextNode(text));
        this.caretToEnd();
        this.changed();
    }

    appendText(text: string): void {
        this.caretToEnd();
        const current = this.text;
        this.insertText(current.trim() && !/\s$/.test(current) ? ` ${text}` : text);
    }

    insertText(text: string): void {
        this.focus();
        // execCommand keeps the native undo stack; fall back to a manual insert.
        if (!document.execCommand('insertText', false, text)) {
            this.insertNode(document.createTextNode(text));
        }
        this.changed();
    }

    insertCode(data: Omit<ContextChip, 'id'>): ContextChip {
        const chip: ContextChip = { ...data, id: nextId() };
        this.tokens.set(chip.id, { kind: 'code', chip });
        this.insertChipNode(this.codeNode(chip));
        return chip;
    }

    insertImage(image: ImageChip): void {
        this.tokens.set(image.id, { kind: 'image', image });
        this.insertChipNode(this.imageNode(image));
    }

    remove(id: string): void {
        this.el.querySelector(`[${CHIP_ATTR}="${id}"]`)?.remove();
        this.tokens.delete(id);
        this.hidePreview();
        this.changed();
        this.el.focus();
    }

    dispose(): void {
        this.hidePreview();
    }

    /** IDEA-187: the text before the caret in its text node (the `@query` being typed). */
    textBeforeCaret(): string {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        if (!range || !range.collapsed || !this.el.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) {
            return '';
        }
        return (range.startContainer.textContent ?? '').slice(0, range.startOffset);
    }

    /** IDEA-187: replaces the `count` characters before the caret (the `@query`) with `text`. */
    replaceBeforeCaret(count: number, text: string): void {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        if (!selection || !range || range.startContainer.nodeType !== Node.TEXT_NODE || !this.el.contains(range.startContainer)) {
            this.insertText(text);
            return;
        }
        const node = range.startContainer;
        const end = range.startOffset;
        const select = document.createRange();
        select.setStart(node, Math.max(0, end - count));
        select.setEnd(node, end);
        selection.removeAllRanges();
        selection.addRange(select);
        if (!document.execCommand('insertText', false, text)) {
            select.deleteContents();
            this.insertNode(document.createTextNode(text));
        }
        this.saveRange();
        this.changed();
    }

    /** Caret after the last character (drops outside the input land at the end). */
    moveCaretToEnd(): void {
        this.el.focus();
        this.caretToEnd();
        this.saveRange();
    }

    /** Puts the caret where a drop happened. */
    caretAt(x: number, y: number): void {
        const range = document.caretRangeFromPoint?.(x, y);
        if (range && this.el.contains(range.startContainer)) {
            this.savedRange = range;
            this.el.focus();
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
    }

    protected changed(): void {
        // Keep tokens for chips still in the DOM only.
        for (const id of [...this.tokens.keys()]) {
            if (!this.el.querySelector(`[${CHIP_ATTR}="${id}"]`)) {
                this.tokens.delete(id);
            }
        }
        this.el.classList.toggle('empty', !this.el.textContent?.replace(/\u200b/g, '') && !this.tokens.size);
        this.handlers.onChange();
    }

    protected saveRange(): void {
        const selection = window.getSelection();
        if (selection?.rangeCount && this.el.contains(selection.getRangeAt(0).startContainer)) {
            this.savedRange = selection.getRangeAt(0).cloneRange();
        }
    }

    protected restoreRange(): void {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }
        if (selection.rangeCount && this.el.contains(selection.getRangeAt(0).startContainer)) {
            return;
        }
        if (this.savedRange && this.el.contains(this.savedRange.startContainer)) {
            selection.removeAllRanges();
            selection.addRange(this.savedRange);
        } else {
            this.caretToEnd();
        }
    }

    protected caretToEnd(): void {
        const range = document.createRange();
        range.selectNodeContents(this.el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        this.savedRange = range.cloneRange();
    }

    protected currentRange(): Range {
        this.focus();
        const selection = window.getSelection()!;
        return selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
    }

    protected insertNode(node: Node): void {
        const range = this.currentRange();
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        this.savedRange = range.cloneRange();
    }

    /** A chip followed by a space so typing continues after it. */
    protected insertChipNode(node: HTMLElement): void {
        const range = this.currentRange();
        const before = range.startContainer.nodeType === Node.TEXT_NODE ? (range.startContainer.textContent ?? '').slice(0, range.startOffset) : '';
        if (before && !/\s$/.test(before)) {
            this.insertNode(document.createTextNode(' '));
        }
        this.insertNode(node);
        this.insertNode(document.createTextNode('\u00a0'));
        this.changed();
    }

    protected codeNode(chip: ContextChip): HTMLElement {
        const span = this.chipShell(chip.id, `ingot-chip ingot-chip-code ingot-chip-inline${chip.whole ? ' ingot-chip-file' : ''}${chip.rule ? ' ingot-chip-rule' : ''}`);
        span.dataset.path = chip.path;
        const icon = document.createElement('span');
        icon.className = chip.rule ? 'codicon codicon-law' : chip.path ? fileIconClass(chip.path.split('/').pop() ?? chip.path) : 'codicon codicon-code';
        const label = document.createElement('span');
        label.className = 'ingot-chip-label';
        label.textContent = chipLabel(chip);
        span.append(icon, label, this.removeButton(chip.id, chipLabel(chip)));
        return span;
    }

    protected imageNode(image: ImageChip): HTMLElement {
        const span = this.chipShell(image.id, 'ingot-chip ingot-chip-image ingot-chip-inline');
        const img = document.createElement('img');
        img.className = 'ingot-chip-thumb';
        img.alt = image.name;
        img.src = `data:${image.mediaType};base64,${image.data}`;
        const label = document.createElement('span');
        label.className = 'ingot-chip-label';
        label.textContent = image.name;
        span.append(img, label, this.removeButton(image.id, image.name));
        return span;
    }

    protected chipShell(id: string, className: string): HTMLElement {
        const span = document.createElement('span');
        span.className = className;
        span.contentEditable = 'false';
        span.setAttribute(CHIP_ATTR, id);
        return span;
    }

    protected removeButton(id: string, label: string): HTMLElement {
        const button = document.createElement('span');
        button.className = 'ingot-chip-remove codicon codicon-close';
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', `Remove ${label}`);
        button.dataset.remove = id;
        return button;
    }

    protected chipOf(node: Node | null): HTMLElement | undefined {
        const el = node instanceof HTMLElement ? node : node?.parentElement;
        const chip = el?.closest<HTMLElement>(`[${CHIP_ATTR}]`);
        return chip && this.el.contains(chip) ? chip : undefined;
    }

    protected onClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const removeId = target.dataset?.remove;
        if (removeId) {
            e.preventDefault();
            this.remove(removeId);
            return;
        }
        const chip = this.chipOf(target);
        const token = chip ? this.tokens.get(chip.getAttribute(CHIP_ATTR)!) : undefined;
        if (token?.kind === 'code') {
            this.handlers.openCode(token.chip);
        } else if (token?.kind === 'image') {
            this.handlers.openImage(token.image);
        }
    }

    /** The chip right before (back) or after (forward) a collapsed caret, skipping empty text. */
    protected adjacentChip(forward: boolean): HTMLElement | undefined {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.isCollapsed) {
            return undefined;
        }
        const { startContainer: node, startOffset: offset } = selection.getRangeAt(0);
        let sibling: Node | null;
        if (node.nodeType === Node.TEXT_NODE) {
            const atEdge = forward ? offset >= (node.textContent ?? '').length : offset === 0;
            if (!atEdge) {
                return undefined;
            }
            sibling = forward ? node.nextSibling : node.previousSibling;
        } else {
            sibling = forward ? node.childNodes[offset] ?? null : node.childNodes[offset - 1] ?? null;
        }
        return sibling instanceof HTMLElement && sibling.hasAttribute(CHIP_ATTR) ? sibling : undefined;
    }

    protected onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const chip = this.adjacentChip(e.key === 'Delete');
            if (chip) {
                e.preventDefault();
                this.remove(chip.getAttribute(CHIP_ATTR)!);
            }
        }
    }

    protected onHover(e: MouseEvent): void {
        const chip = this.chipOf(e.target as Node);
        const token = chip ? this.tokens.get(chip.getAttribute(CHIP_ATTR)!) : undefined;
        if (!chip || !token) {
            return;
        }
        this.hidePreview();
        const preview = document.createElement('div');
        preview.className = 'ingot-chip-preview ingot-chip-preview-floating';
        preview.setAttribute('role', 'tooltip');
        if (token.kind === 'code') {
            const path = document.createElement('div');
            path.className = 'ingot-chip-preview-path';
            path.textContent = `${token.chip.path}:${token.chip.start}-${token.chip.end}`;
            const pre = document.createElement('pre');
            pre.textContent = chipPreview(token.chip.text);
            preview.append(path, pre);
        } else {
            const img = document.createElement('img');
            img.src = `data:${token.image.mediaType};base64,${token.image.data}`;
            img.alt = token.image.name;
            preview.append(img);
        }
        document.body.append(preview);
        const box = chip.getBoundingClientRect();
        const height = preview.offsetHeight;
        preview.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - preview.offsetWidth - 8))}px`;
        preview.style.top = `${box.top - height - 6 > 8 ? box.top - height - 6 : box.bottom + 6}px`;
        this.preview = preview;
    }

    protected hidePreview(): void {
        this.preview?.remove();
        this.preview = undefined;
    }
}
