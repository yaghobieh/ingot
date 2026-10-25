export const INGOT_GROUP_EXT = 'ingot-group';

export const GROUP_COMMANDS = {
    newGroup: { id: 'ingot.group.new', label: 'New Project Group…', category: 'Ingot' },
    addProject: { id: 'ingot.group.addProject', label: 'Add Project to Group…', category: 'Ingot' },
    removeProject: { id: 'ingot.group.removeProject', label: 'Remove Project from Group', category: 'Ingot' },
    nextProject: { id: 'ingot.group.nextProject', label: 'Next Project Tab', category: 'Ingot' },
    previousProject: { id: 'ingot.group.previousProject', label: 'Previous Project Tab', category: 'Ingot' }
} as const;

export const GROUP_NAME_PROMPT = 'Name of the project group (saved as <name>.ingot-group next to the project)';
export const PROJECT_TABS_ID = 'ingot-project-tabs';
