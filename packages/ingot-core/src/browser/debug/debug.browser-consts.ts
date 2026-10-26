import type { DebugRuntimeKind, GuidePlatform } from '../../common/debug/debug.types';

export const DEBUG_TEXT = {
    noConfiguration: 'No run/debug configuration found for this project. Create one to start debugging.',
    createConfiguration: 'Create Configuration',
    savedGroup: 'Configurations',
    detectedGroup: 'Detected in this project',
    pickPlaceholder: 'Select a run/debug configuration',
    install: 'Install',
    installInTerminal: 'Install in Terminal',
    openGuide: 'Open Guide',
    adapterMissing: (label: string): string => `${label} is not installed yet. Install it from Open VSX to debug this configuration.`,
    xdebugMissing: 'PHP is installed, but the Xdebug extension is not loaded',
    xdebugWhy: (ini: string): string => `Install Xdebug, then add to php.ini: ${ini}`,
    xdebugInstall: { mac: 'pecl install xdebug', linux: 'sudo apt install php-xdebug', windows: 'start https://xdebug.org/wizard' } as Readonly<Record<GuidePlatform, string>>,
    terminalTitle: (kind: DebugRuntimeKind): string => `Install ${kind === 'php' ? 'PHP' : kind === 'java' ? 'Java' : kind === 'node' ? 'Node.js' : 'Python'}`
} as const;

export const CONFIG_EDITOR_TEXT = {
    listTitle: 'Configurations',
    add: 'Add a configuration',
    addPlaceholder: '+ Add',
    detectedGroup: 'Detected in this project',
    templatesGroup: 'Templates',
    empty: 'No configurations yet. Use + Add to create one from this project or a template.',
    unsaved: 'new',
    savedIn: (file: string): string => `Saved in ${file}`,
    name: 'Name',
    type: 'Type',
    json: 'All settings (JSON)',
    jsonNeedsTypeAndName: 'A configuration needs a "type" and a "name".',
    duplicateName: (name: string): string => `A configuration named "${name}" already exists.`,
    debug: 'Debug',
    run: 'Run',
    remove: 'Remove',
    save: 'Save',
    openFile: 'Open launch.json',
    pick: 'Select a configuration on the left, or add one.',
    noProject: 'Open a project to manage its run/debug configurations.'
} as const;

export const DEBUG_TOOLBAR_TEXT = {
    selectConfiguration: 'Run/Debug configuration',
    controls: 'Debugger controls',
    resume: 'Resume Program',
    pause: 'Pause Program',
    stepOver: 'Step Over',
    stepInto: 'Step Into',
    stepOut: 'Step Out',
    restart: 'Restart'
} as const;

export const DEBUG_RUNTIME_LIST = ['java', 'php', 'node', 'python'] as const;
