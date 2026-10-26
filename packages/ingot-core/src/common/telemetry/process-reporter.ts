import { createErrorReporter, type ErrorReporter } from './error-reporter';
import { SENTRY_DSN_ENV, SENTRY_ENVIRONMENT_ENV } from './telemetry.consts';

/** Reports uncaught exceptions and unhandled rejections of a Node process (backend, Electron main). No-op without SENTRY_DSN. */
export function installProcessReporter(component: string, env: NodeJS.ProcessEnv = process.env, target: NodeJS.Process = process): ErrorReporter {
    const reporter = createErrorReporter({ component, dsn: env[SENTRY_DSN_ENV], environment: env[SENTRY_ENVIRONMENT_ENV] ?? env.NODE_ENV, release: env.npm_package_version });
    if (reporter.enabled) {
        target.on('uncaughtExceptionMonitor', error => void reporter.capture(error, { kind: 'uncaught' }));
        target.on('unhandledRejection', reason => void reporter.capture(reason, { kind: 'unhandled_rejection' }));
    }
    return reporter;
}
