import {
    LIBRARY_ASK_QUESTION, LIBRARY_EXAMPLE_PREFIXES, LIBRARY_NODE_LAYERED, LIBRARY_NODE_MODULAR, LIBRARY_REACT_ATOMIC, LIBRARY_REACT_FEATURE, LIBRARY_STRUCTURE_OPTIONS,
    NODE_STRUCTURES, REACT_STRUCTURES
} from './library-app.consts';
import type { LibraryFile, LibraryPlan, LibraryPrompt, NodeStructure, ReactStructure } from './library-app.types';
import { libraryClientFiles, libraryServerFiles, librarySharedFiles } from './library-app.files';

const LIBRARY_INTENT = /\b(create|scaffold|start|build|make)\b/i;
const NODE_WORD = /\bnode(?:\.?js)?\b/i;
const PATH_MARK = /\b(?:open it at path|at path|open it at|put it here|put here|right here|here)\s+["']?([^\s"']+)["']?/i;
const ABSOLUTE_PATH = /(?:^|\s)((?:\/(?:[\w.-]+\/){2,}[\w.-]+)|(?:[A-Za-z]:\\(?:[\w.-]+\\){1,}[\w.-]+))/g;
/** "structure X" / "structure Y" means the user has not named a layout yet. */
const UNNAMED_STRUCTURE = /\bstructure\s+[xy]\b/i;

const isReact = (value: string): value is ReactStructure => (REACT_STRUCTURES as readonly string[]).includes(value);
const isNode = (value: string): value is NodeStructure => (NODE_STRUCTURES as readonly string[]).includes(value);

export const reactStructureFromText = (text: string): ReactStructure | undefined => {
    if (/\bfeature[- ]folders?\b/i.test(text)) {
        return LIBRARY_REACT_FEATURE;
    }
    if (/\batomic\b/i.test(text)) {
        return LIBRARY_REACT_ATOMIC;
    }
    return undefined;
};

export const nodeStructureFromText = (text: string): NodeStructure | undefined => {
    if (/\blayered\b/i.test(text)) {
        return LIBRARY_NODE_LAYERED;
    }
    if (/\bmodular\b/i.test(text)) {
        return LIBRARY_NODE_MODULAR;
    }
    return undefined;
};

/** A listed example tree names a preset when it contains that preset's folders. */
export const reactStructureFromTree = (paths: readonly string[]): ReactStructure | undefined => {
    if (paths.some(item => /(^|\/)features(\/|$)/.test(item))) {
        return LIBRARY_REACT_FEATURE;
    }
    if (paths.some(item => /(^|\/)atoms(\/|$)/.test(item))) {
        return LIBRARY_REACT_ATOMIC;
    }
    return undefined;
};

export const nodeStructureFromTree = (paths: readonly string[]): NodeStructure | undefined => {
    if (paths.some(item => /(^|\/)controllers(\/|$)/.test(item))) {
        return LIBRARY_NODE_LAYERED;
    }
    if (paths.some(item => /(^|\/)modules(\/|$)/.test(item))) {
        return LIBRARY_NODE_MODULAR;
    }
    return undefined;
};

const examplePaths = (text: string): string[] => {
    const found: string[] = [];
    const pattern = /(?:^|\s)["']?((?:\/|\.\/|\.\.\/)[^\s"']+)["']?/g;
    for (const match of text.matchAll(pattern)) {
        const value = match[1];
        if (value && LIBRARY_EXAMPLE_PREFIXES.some(prefix => value.startsWith(prefix))) {
            found.push(value.replace(/[.,;:]+$/, ''));
        }
    }
    return found;
};

/** True when the user asked for a new React and Node project. "nodejs" counts; a task is not a question about the open repo. */
export const isLibraryPrompt = (text: string): boolean =>
    LIBRARY_INTENT.test(text) && /\breact\b/i.test(text) && NODE_WORD.test(text);

/** "rules" / "skills", including the typo "skeels". */
export const wantsProjectSkills = (text: string): boolean => /\b(rules?|skills?|skeels?|skeils?|skils?)\b/i.test(text);

/** Folder the new project should be created in. Named phrases win, then the last absolute path. */
export const destinationPath = (text: string): string | undefined => {
    const marked = text.match(PATH_MARK)?.[1]?.replace(/[.,;:]+$/, '');
    if (marked && (marked.startsWith('/') || /^[A-Za-z]:\\/.test(marked))) {
        return marked;
    }
    const found = [...text.matchAll(ABSOLUTE_PATH)].map(match => match[1]).filter((item): item is string => !!item);
    return found[found.length - 1];
};

/**
 * Reads a create-library prompt. Named presets win. An example folder is kept so the tool can
 * look at its tree. Anything still unnamed is ambiguous and should go through the ask-user card.
 */
export const parseLibraryPrompt = (text: string): LibraryPrompt | undefined => {
    if (!isLibraryPrompt(text)) {
        return undefined;
    }
    const examples = examplePaths(text).filter(item => item !== destinationPath(text));
    const reactExample = examples.find(item => /react|client|ui|features|atoms/i.test(item));
    const nodeExample = examples.find(item => item !== reactExample && /node|server|api|controllers|modules/i.test(item))
        ?? examples.find(item => item !== reactExample);
    const unnamed = UNNAMED_STRUCTURE.test(text);
    let react = reactStructureFromText(text);
    let node = nodeStructureFromText(text);
    const path = destinationPath(text);
    // A path with no named layout still gets a clean default, so the agent creates the folder instead of describing the open repo.
    if (!unnamed && path && !react && !reactExample) {
        react = LIBRARY_REACT_FEATURE;
    }
    if (!unnamed && path && !node && !nodeExample) {
        node = LIBRARY_NODE_LAYERED;
    }
    return {
        ...(path ? { path } : {}),
        ...(react ? { react } : {}),
        ...(node ? { node } : {}),
        ...(reactExample ? { reactExample } : {}),
        ...(nodeExample ? { nodeExample } : {}),
        ambiguous: unnamed || !react || !node || !path
    };
};

export const libraryAsk = (): { question: string; options: readonly string[] } => ({
    question: LIBRARY_ASK_QUESTION,
    options: LIBRARY_STRUCTURE_OPTIONS
});

/** One hidden nudge so a model that only talks still asks, or creates, instead of stopping. */
export const libraryNudge = (prompt: LibraryPrompt): string => {
    if (prompt.ambiguous || !prompt.react || !prompt.node || !prompt.path) {
        const known = [
            prompt.path ? `Path: ${prompt.path}.` : 'The prompt did not give a folder. Ask for an absolute path too.',
            prompt.react ? `React structure: ${prompt.react}.` : '',
            prompt.node ? `Node structure: ${prompt.node}.` : '',
            prompt.reactExample ? `React example folder: ${prompt.reactExample}.` : '',
            prompt.nodeExample ? `Node example folder: ${prompt.nodeExample}.` : ''
        ].filter(Boolean).join(' ');
        return [
            'The user wants a new React and Node.js library project, and the layout is not fully decided.',
            known,
            `Call ingot/ask_user with question "${LIBRARY_ASK_QUESTION}" and options ${JSON.stringify([...LIBRARY_STRUCTURE_OPTIONS])}.`,
            'Wait for the answer, then call ingot/create_library. Do not invent files by hand.'
        ].join(' ');
    }
    return [
        `Call ingot/create_library with {"path":${JSON.stringify(prompt.path)},"react":"${prompt.react}","node":"${prompt.node}"}.`,
        'Then run npm install, npm test and npm run build in that folder (cwd). If tests fail, fix the files and rerun npm test, up to 3 times.',
        'Then ask whether to git init on branch feature/library and commit. Last, call ingot/open_workspace with that path.'
    ].join(' ');
};

const MIN_PATH_SEGMENTS = 2;

/** Absolute path with at least two segments (`/tmp/library`, not `/` or `/tmp`). */
export const libraryPathError = (abs: string): string | undefined => {
    const segments = abs.split(/[/\\]/).filter(Boolean);
    if (segments.length < MIN_PATH_SEGMENTS) {
        return `Refusing to create a project at "${abs}". Pick a new empty folder, not a filesystem root.`;
    }
    return undefined;
};

export const libraryCommandNeedsTime = (command: string): boolean =>
    /\bnpm\b/.test(command) && /\b(install|ci|test|build)\b/.test(command);

export const libraryFiles = (plan: LibraryPlan): LibraryFile[] => [
    ...librarySharedFiles(plan.rules === true),
    ...libraryServerFiles(plan.node),
    ...libraryClientFiles(plan.react)
];

export const isReactStructure = isReact;
export const isNodeStructure = isNode;
