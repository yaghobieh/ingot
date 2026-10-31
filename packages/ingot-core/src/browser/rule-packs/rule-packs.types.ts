/** Removes one pack (wired by the contribution, which reports the result). */
export const RulePackRemover = Symbol('IngotRulePackRemover');
export interface RulePackRemover {
    removePack(key: string): Promise<void>;
}
