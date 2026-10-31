/** Plan ids from ingot-server, after `normalizePlan` ("PRO+", "pro_plus", "Pro Plus" and "pro-plus" all match). */
export const PRO_PLUS_PLANS: readonly string[] = ['pro+', 'proplus'];

/** `/api/me` role of an administrator account. */
export const ADMIN_ROLE = 'admin';

/** Owner accounts that are treated as admin (Pro+, nothing gated) even before the server sends the admin role. */
export const OWNER_ACCOUNT_EMAILS: readonly string[] = ['yaghobieh@gmail.com'];

/** Separators the server and older portal builds put inside plan ids. */
export const PLAN_SEPARATORS = /[\s_-]+/g;
