import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { ROUTER_PREFS } from '../../common/router/router.consts';
import { COST_PREFS, DEFAULT_WARN_USD } from '../../common/cost/cost.consts';

/** IDEA-307 cost forecast and Autopilot model router (Settings › Tools › Context, plans & cost). */
export const routerPreferenceSchema: PreferenceSchema = {
    properties: {
        [COST_PREFS.forecast]: {
            type: 'boolean', default: true,
            description: 'Cost forecast: show an estimate of the next run\'s cost in the composer (estimated tokens × the model\'s list price).'
        },
        [COST_PREFS.warnUsd]: {
            type: 'number', default: DEFAULT_WARN_USD, minimum: 0,
            description: 'Cost forecast: ask before sending a run estimated above this many US dollars (0 = never ask).'
        },
        [ROUTER_PREFS.enabled]: {
            type: 'boolean', default: false,
            description: 'Autopilot model router: send simple steps (short questions, explanations, docs, renames, formatting) to a cheaper connected model. Chinese-origin models (DeepSeek, Qwen, Kimi, GLM, MiniMax, Baichuan, Yi and others) and OpenRouter auto are never picked.'
        }
    }
};
