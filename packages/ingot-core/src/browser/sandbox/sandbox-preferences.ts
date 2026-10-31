import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { SANDBOX_PREFS } from '../../common/sandbox/sandbox.consts';

/** IDEA-288 / IDEA-293: Settings › Agent approvals. */
export const sandboxPreferenceSchema: PreferenceSchema = {
    properties: {
        [SANDBOX_PREFS.reviewModel]: {
            type: 'string', default: '',
            description: 'Model for auto-review (sandbox approvals) and AI code review. Empty: a cheap connected model, else the chat\'s model.'
        }
    }
};
