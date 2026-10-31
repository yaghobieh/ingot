import type { Command } from '@theia/core/lib/common/command';
import { RULES_TOOLS_COMMANDS } from '../../common/rules-tools/rules-tools.consts';

/** Buttons in the Rules tab header of the Rules & MCP page. */
export const RULES_TAB_TOOLS: readonly { readonly id: string; readonly label: string; readonly icon: string; readonly command: Command }[] = [
    { id: 'test', label: 'Test', icon: 'beaker', command: RULES_TOOLS_COMMANDS.test },
    { id: 'prune', label: 'Prune', icon: 'trash', command: RULES_TOOLS_COMMANDS.prune },
    { id: 'export', label: 'Export', icon: 'export', command: RULES_TOOLS_COMMANDS.export }
];
