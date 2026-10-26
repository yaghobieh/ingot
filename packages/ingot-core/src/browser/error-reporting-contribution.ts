import { injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { createErrorReporter } from '../common/telemetry/error-reporter';
import { ERROR_REPORTING_PATH, MAX_RENDERER_REPORTS } from '../common/telemetry/telemetry.consts';

interface ReportingConfig { readonly dsn?: string; readonly environment?: string }

/** IDEA-149: renderer errors go to Sentry only when the backend has SENTRY_DSN. Scrubbed, no code, prompts or keys. */
@injectable()
export class ErrorReportingContribution implements FrontendApplicationContribution {

    onStart(): void {
        void this.install();
    }

    protected async install(): Promise<void> {
        const config: ReportingConfig = await fetch(ERROR_REPORTING_PATH)
            .then(res => (res.ok ? res.json() as Promise<ReportingConfig> : {}))
            .catch(() => ({}));
        const reporter = createErrorReporter({ component: 'ide-renderer', dsn: config.dsn, environment: config.environment });
        if (!reporter.enabled) {
            return;
        }
        let sent = 0;
        const report = (error: unknown) => {
            if (sent >= MAX_RENDERER_REPORTS) {
                return;
            }
            sent += 1;
            void reporter.capture(error);
        };
        window.addEventListener('error', event => report(event.error ?? event.message));
        window.addEventListener('unhandledrejection', event => report(event.reason));
    }
}
