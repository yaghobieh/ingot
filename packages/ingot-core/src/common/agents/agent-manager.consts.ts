import type { ManagerState } from './agent-manager.types';

/** IDEA-291: Agent Manager copy. */
export const MANAGER_STATE_LABEL: Record<ManagerState, string> = {
    running: 'Running', approval: 'Needs approval', question: 'Has a question', paused: 'Paused', review: 'To review', error: 'Needs attention', done: 'Done', idle: 'Idle'
};
export const APPROVAL_ID_PREFIX = 'approval-';
export const STEP_CHARS = 120;
export const BASE36 = 36;
