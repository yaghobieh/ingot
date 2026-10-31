import type { GatedFeature } from '../../common/plan/plan.types';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { HOOKS_COMMANDS } from '../hooks/hooks.consts';
import { LAYOUT_COMMANDS } from '../layout/layout.browser-consts';
import { GEAR_COMMANDS } from '../workbench/gear-menu.consts';
import { TITLEBAR_COMMANDS } from '../workbench/titlebar.consts';

export const PLAN_COMMANDS = {
    upgrade: { id: 'ingot.plan.upgrade', label: 'Upgrade to Pro', category: 'Ingot' }
} as const;

/** Context keys: the current tier, and whether AI chat is open on it. */
export const PLAN_TIER_KEY = 'ingotPlanTier';
export const PLAN_AI_KEY = 'ingotPlanAi';

export const PLAN_UPGRADE_STATUS_ID = 'ingot-plan-upgrade';
/** Just left of the account item (200). */
export const PLAN_UPGRADE_STATUS_PRIORITY = 199;

export const PLAN_TEXT = {
    upgrade: 'Upgrade to Pro',
    upgradeAction: 'See plans',
    statusTooltip: 'Ingot Community: the editor, Git, terminal, debugger and extensions are free. AI agent and chat come with Pro.',
    locked: (feature: string, tier: string): string => `${feature} is part of Ingot ${tier}. The editor, Git, terminal, debugger and extensions stay free.`
} as const;

/** Commands behind a plan: on a lower tier they open the upgrade prompt instead of running. */
export const GATED_COMMANDS: Readonly<Record<string, GatedFeature>> = {
    [AGENT_COMMANDS.toggle.id]: 'chat',
    [AGENT_COMMANDS.newAgent.id]: 'chat',
    [AGENT_COMMANDS.history.id]: 'chat',
    [AGENT_COMMANDS.addSelectionToChat.id]: 'chat',
    [AGENT_COMMANDS.cycleMode.id]: 'agent',
    [AGENT_COMMANDS.memories.id]: 'agent',
    [AGENT_COMMANDS.demoEdit.id]: 'agent',
    [GEAR_COMMANDS.memories.id]: 'agent',
    [HOOKS_COMMANDS.fixWithAgent.id]: 'agent',
    [LAYOUT_COMMANDS.chatRight.id]: 'chat',
    [LAYOUT_COMMANDS.chatBottom.id]: 'chat',
    [TITLEBAR_COMMANDS.agentsWindow.id]: 'multiAgent'
};
