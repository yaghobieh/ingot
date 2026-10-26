/** IDEA-149: error tracking is off unless SENTRY_DSN is set where the backend / Electron main process runs. */
export const SENTRY_DSN_ENV = 'SENTRY_DSN';
export const SENTRY_ENVIRONMENT_ENV = 'SENTRY_ENVIRONMENT';
/** The renderer asks the backend for the (public) DSN here, so no secret is baked into the frontend bundle. */
export const ERROR_REPORTING_PATH = '/ingot/error-reporting';
export const MAX_RENDERER_REPORTS = 10;
