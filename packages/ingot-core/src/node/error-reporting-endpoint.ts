import { injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import type { Application } from '@theia/core/shared/express';
import { installProcessReporter } from '../common/telemetry/process-reporter';
import { ERROR_REPORTING_PATH, SENTRY_DSN_ENV, SENTRY_ENVIRONMENT_ENV } from '../common/telemetry/telemetry.consts';

/** IDEA-149: backend crash reporting, and the renderer's DSN (a DSN is a public key, never a secret). */
@injectable()
export class ErrorReportingEndpoint implements BackendApplicationContribution {

    initialize(): void {
        installProcessReporter('ide-backend');
    }

    configure(app: Application): void {
        app.get(ERROR_REPORTING_PATH, (_req, res) => {
            res.setHeader('cache-control', 'no-store');
            res.json({ dsn: process.env[SENTRY_DSN_ENV] ?? '', environment: process.env[SENTRY_ENVIRONMENT_ENV] ?? process.env.NODE_ENV ?? '' });
        });
    }
}
