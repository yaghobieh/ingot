import type { Command } from '@theia/core/lib/common/command';

export const SPECS_WIDGET_ID = 'ingot-specs';
export const SPECS_WIDGET_LABEL = 'Specs';
/** Context key set while focus is inside the Specs view (scopes its Ingot shortcuts). */
export const SPECS_FOCUS_KEY = 'ingotSpecsFocus';

export const SPECS_COMMANDS = {
    toggle: { id: 'ingot.specs.toggle', label: 'Specs', category: 'View' } as Command,
    create: { id: 'ingot.specs.create', label: 'Create Spec…', category: 'Agents' } as Command,
    runNext: { id: 'ingot.specs.runNext', label: 'Run Next Spec Task', category: 'Agents' } as Command,
    refresh: { id: 'ingot.specs.refresh', label: 'Refresh Specs', category: 'Agents' } as Command
};

/** Coalesces a burst of file events (an agent writing three docs) into one reload. */
export const SPECS_REFRESH_DEBOUNCE_MS = 150;
export const PERCENT = 100;

export const SPECS_TEXT = {
    caption: 'Kiro-style specs in .ingot/specs (Beta)',
    beta: 'Beta',
    empty: 'No specs yet. A spec is requirements.md, design.md and tasks.md in .ingot/specs/<feature>/; the agent runs the tasks one by one.',
    noProject: 'Open a project to use specs.',
    create: 'New spec',
    namePrompt: 'Feature name (e.g. "user login")',
    summaryPrompt: 'One line: what should it do? (optional)',
    exists: 'A spec with that name already exists.',
    runNext: 'Run next task',
    runTask: 'Run this task with the agent',
    requirements: 'Requirements',
    allDone: 'All tasks done',
    noTasks: 'No tasks yet: add a checklist to tasks.md',
    refresh: 'Refresh',
    docMissing: 'missing'
} as const;
