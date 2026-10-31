/** In-chat cards that share the agent card look (agent-cards.css): approval, ask, doom-loop pause, plan review, handoff, cost warning, habits. */
export const AGENT_CARD_CLASSES = [
    '.ingot-approval',
    '.ingot-ask.ingot-ask-card',
    '.ingot-doom-card',
    '.ingot-plan-review',
    '.ingot-handoff-offer',
    '.ingot-cost-confirm',
    '.ingot-habit-card',
    '.ingot-habit-checklist'
] as const;

/** Height of the buttons inside agent cards (Skip / Run, Send anyway, Try a different approach…). */
export const AGENT_CARD_BUTTON_HEIGHT_PX = 24;
