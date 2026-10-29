import type { NodeStructure, ReactStructure } from './library-app.types';

export const CREATE_LIBRARY_TOOL = 'create_library';
export const OPEN_WORKSPACE_TOOL = 'open_workspace';

export const REACT_STRUCTURES: readonly ReactStructure[] = ['feature-folders', 'atomic'];
export const NODE_STRUCTURES: readonly NodeStructure[] = ['layered', 'modular'];

/** Shown on the ask-user card when the layout was not named. */
export const LIBRARY_STRUCTURE_OPTIONS = [
    'React feature-folders, Node layered',
    'React feature-folders, Node modular',
    'React atomic, Node layered',
    'React atomic, Node modular'
] as const;

export const LIBRARY_ASK_QUESTION = 'Which structures should the library project use?';

/** npm install / test / build of a new app can outlast the usual foreground limit. */
export const LIBRARY_COMMAND_TIMEOUT_SECONDS = 300;

export const LIBRARY_SERVER_PORT = 3001;

export const LIBRARY_REACT_FEATURE = 'feature-folders';
export const LIBRARY_REACT_ATOMIC = 'atomic';
export const LIBRARY_NODE_LAYERED = 'layered';
export const LIBRARY_NODE_MODULAR = 'modular';

/** A folder the user named, not a preset word. */
export const LIBRARY_EXAMPLE_PREFIXES = ['/', './', '../'] as const;

/** How many directory levels of an example folder are read to recognise a layout. */
export const LIBRARY_EXAMPLE_DEPTH = 4;

/** Let the open-folder tool result paint before the workspace reload. */
export const OPEN_WORKSPACE_DELAY_MS = 50;
