import type { Command } from '@theia/core/lib/common/command';

/** Annotate with Git Blame (IDEA-83). */
export const ANNOTATE_COMMANDS = {
    toggle: { id: 'ingot.annotate.toggle', label: 'Annotate with Git Blame', category: 'Git' },
    close: { id: 'ingot.annotate.close', label: 'Close Annotations', category: 'Git' },
    previous: { id: 'ingot.annotate.previous', label: 'Annotate Previous Revision', category: 'Git' },
    lineHistory: { id: 'ingot.annotate.lineHistory', label: 'Show History for Line', category: 'Git' },
    details: { id: 'ingot.annotate.details', label: 'Show Annotation Details', category: 'Git' }
} satisfies Record<string, Command>;

export const ANNOTATED_CONTEXT_KEY = 'ingotAnnotated';
export const ANNOTATION_MIN_CHARS = 30;
export const ANNOTATION_CLASS = 'ingot-annotation';
