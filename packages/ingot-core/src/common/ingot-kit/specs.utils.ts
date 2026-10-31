import { SPEC_DOC_FILES, SPEC_SLUG_MAX, SPEC_TASK_TOOL, SPECS_DIR, TASK_INDENT, TASK_LINE, TASK_REQUIREMENTS_LINE } from './ingot-kit.consts';
import type { PlannedFile, SpecDoc, SpecProgress, SpecSummary, SpecTask } from './ingot-kit.types';

export const specSlug = (name: string): string =>
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SPEC_SLUG_MAX).replace(/-+$/, '');

export const specTitle = (slug: string): string => slug.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export const specDir = (slug: string): string => `${SPECS_DIR}/${slug}`;

export const specDocPath = (slug: string, doc: SpecDoc): string => `${specDir(slug)}/${SPEC_DOC_FILES[doc]}`;

const requirementsTemplate = (title: string, summary: string): string => `# Requirements: ${title}

## Introduction

${summary || `Describe ${title} in two or three sentences: who it is for and what changes for them.`}

## Requirements

### Requirement 1

**User story:** As a <role>, I want <capability>, so that <benefit>.

#### Acceptance criteria

1. WHEN <event> THEN the system SHALL <response>
2. IF <precondition> THEN the system SHALL <response>
3. WHILE <state> the system SHALL <behaviour>

### Requirement 2

**User story:** As a <role>, I want <capability>, so that <benefit>.

#### Acceptance criteria

1. WHEN <event> THEN the system SHALL <response>
`;

const designTemplate = (title: string): string => `# Design: ${title}

## Overview

How ${title} meets the requirements in [requirements.md](requirements.md), in a paragraph.

## Architecture

The parts involved and how data flows between them.

## Components and interfaces

- **<Component>:** what it owns, its public functions and events.

## Data models

Types, tables or files added or changed.

## Error handling

What can fail, what the user sees, and how the system recovers.

## Testing strategy

Unit tests for the logic, and an end-to-end test for each acceptance criterion.
`;

const tasksTemplate = (title: string): string => `# Implementation plan: ${title}

Run a task from the Specs view (or ask the agent for "task 1"). The agent ticks a task off when it is done.

- [ ] 1. Set up the module structure and the interfaces from the design
  - _Requirements: 1_
- [ ] 2. Implement the core logic
  - [ ] 2.1 Write the data model and its validation
    - _Requirements: 1.1, 1.2_
  - [ ] 2.2 Write unit tests for the data model
    - _Requirements: 1.1_
- [ ] 3. Wire it into the UI
  - _Requirements: 2_
- [ ] 4. Add an end-to-end test for every acceptance criterion
  - _Requirements: 1, 2_
`;

/** requirements.md, design.md and tasks.md for a new spec (Kiro-style: EARS acceptance criteria and a numbered checklist). */
export const createSpecFiles = (name: string, summary = ''): { slug: string; files: PlannedFile[] } => {
    const slug = specSlug(name);
    if (!slug) {
        throw new Error('A spec needs a name with letters or digits.');
    }
    const typed = name.trim();
    const title = /\s/.test(typed) ? `${typed[0].toUpperCase()}${typed.slice(1)}` : specTitle(slug);
    return {
        slug,
        files: [
            { path: specDocPath(slug, 'requirements'), content: requirementsTemplate(title, summary.trim()) },
            { path: specDocPath(slug, 'design'), content: designTemplate(title) },
            { path: specDocPath(slug, 'tasks'), content: tasksTemplate(title) }
        ]
    };
};

/** The `# Title` of a spec doc, without a `Requirements:` / `Design:` / `Implementation plan:` prefix. */
export const docTitle = (text: string | undefined): string | undefined => {
    const heading = text?.split('\n').find(line => /^#\s+/.test(line));
    return heading?.replace(/^#\s+/, '').replace(/^(requirements|design|implementation plan|tasks)\s*:\s*/i, '').trim() || undefined;
};

/** Checklist items of tasks.md, in order, with their `_Requirements:` references. */
export const parseTasks = (text: string): SpecTask[] => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const tasks: SpecTask[] = [];
    let fence = false;
    lines.forEach((line, index) => {
        if (/^\s*```/.test(line)) {
            fence = !fence;
            return;
        }
        if (fence) {
            return;
        }
        const match = TASK_LINE.exec(line);
        if (match) {
            tasks.push({
                id: match[3] ?? String(tasks.length + 1),
                title: match[4].trim(),
                done: match[2] !== ' ',
                line: index,
                depth: Math.floor(match[1].replace(/\t/g, '  ').length / TASK_INDENT),
                requirements: []
            });
            return;
        }
        const refs = TASK_REQUIREMENTS_LINE.exec(line);
        const last = tasks[tasks.length - 1];
        if (refs && last) {
            tasks[tasks.length - 1] = { ...last, requirements: refs[1].split(',').map(r => r.trim()).filter(Boolean) };
        }
    });
    return tasks;
};

export const findTask = (tasks: readonly SpecTask[], id: string): SpecTask | undefined => {
    const wanted = id.trim().replace(/\.$/, '');
    return tasks.find(t => t.id === wanted);
};

const childrenOf = (tasks: readonly SpecTask[], index: number): SpecTask[] => {
    const parent = tasks[index];
    const out: SpecTask[] = [];
    for (let i = index + 1; i < tasks.length && tasks[i].depth > parent.depth; i++) {
        if (tasks[i].depth === parent.depth + 1) {
            out.push(tasks[i]);
        }
    }
    return out;
};

const setBox = (line: string, done: boolean): string => line.replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');

/**
 * Ticks a task (and every sub-task) on or off. A parent follows its children: it is done once all of them are, and
 * reopens when one of them reopens. Throws for an unknown task id.
 */
export const setTaskDone = (text: string, id: string, done: boolean): string => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let tasks = parseTasks(text);
    const index = tasks.findIndex(t => t.id === id.trim().replace(/\.$/, ''));
    if (index < 0) {
        throw new Error(`No task ${id} in tasks.md.`);
    }
    const target = tasks[index];
    lines[target.line] = setBox(lines[target.line], done);
    for (let i = index + 1; i < tasks.length && tasks[i].depth > target.depth; i++) {
        lines[tasks[i].line] = setBox(lines[tasks[i].line], done);
    }
    for (let changed = true; changed;) {
        changed = false;
        tasks = parseTasks(lines.join('\n'));
        tasks.forEach((task, i) => {
            const children = childrenOf(tasks, i);
            if (!children.length) {
                return;
            }
            const all = children.every(c => c.done);
            if (all !== task.done) {
                lines[task.line] = setBox(lines[task.line], all);
                changed = true;
            }
        });
    }
    return lines.join('\n');
};

/** Leaf tasks count (a parent is done when its sub-tasks are). */
export const specProgress = (tasks: readonly SpecTask[]): SpecProgress => {
    const leaves = tasks.filter((_, i) => !childrenOf(tasks, i).length);
    return { done: leaves.filter(t => t.done).length, total: leaves.length };
};

/** The first open leaf task: what "Run next task" picks. */
export const nextOpenTask = (tasks: readonly SpecTask[]): SpecTask | undefined =>
    tasks.find((t, i) => !t.done && !childrenOf(tasks, i).length);

export const summarizeSpec = (slug: string, docs: Partial<Record<SpecDoc, string>>): SpecSummary => {
    const tasks = docs.tasks === undefined ? [] : parseTasks(docs.tasks);
    return {
        slug,
        title: docTitle(docs.requirements) ?? docTitle(docs.design) ?? docTitle(docs.tasks) ?? specTitle(slug),
        dir: specDir(slug),
        docs: (Object.keys(SPEC_DOC_FILES) as SpecDoc[]).filter(doc => docs[doc] !== undefined),
        tasks,
        progress: specProgress(tasks)
    };
};

/** What the agent is asked when a task runs: read the spec, do this one task, then tick it off with the spec tool. */
export const taskPrompt = (spec: Pick<SpecSummary, 'slug' | 'title' | 'tasks'>, task: SpecTask): string => {
    const subtasks = spec.tasks.filter(t => t.id.startsWith(`${task.id}.`) && !t.done).map(t => `  - ${t.id} ${t.title}`);
    return [
        `Implement task ${task.id} of the "${spec.title}" spec: ${task.title}`,
        ...(subtasks.length ? ['Sub-tasks:', ...subtasks] : []),
        task.requirements.length ? `It covers requirement(s) ${task.requirements.join(', ')}.` : '',
        `Read ${specDocPath(spec.slug, 'requirements')} and ${specDocPath(spec.slug, 'design')} first and follow them. Do only this task.`,
        `When the work is done and checked, call ingot/${SPEC_TASK_TOOL} with {"spec": "${spec.slug}", "task": "${task.id}", "done": true}.`
    ].filter(Boolean).join('\n');
};
