/** Plan ids from ingot-server, after `normalizePlan` ("PRO+", "pro_plus", "Pro Plus" and "pro-plus" all match). */
export const PRO_PLUS_PLANS: readonly string[] = ['pro+', 'proplus'];

/** Separators the server and older portal builds put inside plan ids. */
export const PLAN_SEPARATORS = /[\s_-]+/g;
