/** What the IDE gates on (IDEA-271). Account plans map onto these (team = pro, ultra = proplus). */
export type PlanTier = 'free' | 'pro' | 'proplus';

/** AI features behind a paid tier; the core editor, Git, terminal, debugger and extensions are never gated. */
export type GatedFeature = 'agent' | 'chat' | 'inlineCompletions' | 'rex' | 'multiAgent';
