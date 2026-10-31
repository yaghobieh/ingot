/** IDEA-292: "Use as mode" pins a command or skill into a chat's system prompt, like a custom mode. */
import type { ProjectCommand } from '../project-config/project-config.types';
import { ARGUMENTS_STAND_IN, ARGUMENTS_TOKEN, MODE_PILL_MAX_CHARS } from './custom-mode.consts';
import type { CustomMode } from './custom-mode.types';

export const customModeFrom = (command: Pick<ProjectCommand, 'name' | 'kind' | 'description' | 'body'>): CustomMode => ({
    name: command.name,
    kind: command.kind,
    body: command.body,
    ...(command.description ? { description: command.description } : {})
});

export const findModeCommand = (commands: readonly ProjectCommand[], name: string): ProjectCommand | undefined => {
    const wanted = name.trim().replace(/^\//, '').toLowerCase();
    return commands.find(command => command.name.toLowerCase() === wanted);
};

/** System prompt section: the latest file body when the command still exists, else the body saved with the mode. */
export const customModePrompt = (mode: CustomMode, commands: readonly ProjectCommand[]): string => {
    const body = (findModeCommand(commands, mode.name)?.body ?? mode.body).split(ARGUMENTS_TOKEN).join(ARGUMENTS_STAND_IN).trim();
    return [
        `Custom mode: ${mode.kind === 'skill' ? 'skill' : 'command'} "${mode.name}", pinned by the user for this chat.`,
        'Follow these instructions in every reply until the user clears the mode:',
        body
    ].filter(Boolean).join('\n\n');
};

export const modePillLabel = (mode: Pick<CustomMode, 'name' | 'kind'>): string => {
    const label = mode.kind === 'command' ? `/${mode.name}` : mode.name;
    return label.length > MODE_PILL_MAX_CHARS ? `${label.slice(0, MODE_PILL_MAX_CHARS - 1)}…` : label;
};
