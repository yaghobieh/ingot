import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { installProcessReporter } from './process-reporter';

describe('installProcessReporter (IDEA-149)', () => {
    it('does nothing without SENTRY_DSN', () => {
        const target = new EventEmitter() as unknown as NodeJS.Process;
        expect(installProcessReporter('ide-main', {}, target).enabled).toBe(false);
        expect((target as unknown as EventEmitter).listenerCount('unhandledRejection')).toBe(0);
    });

    it('listens for crashes when SENTRY_DSN is set', () => {
        const target = new EventEmitter() as unknown as NodeJS.Process;
        const reporter = installProcessReporter('ide-main', { SENTRY_DSN: 'https://public@o1.ingest.sentry.io/42' }, target);
        expect(reporter.enabled).toBe(true);
        expect((target as unknown as EventEmitter).listenerCount('uncaughtExceptionMonitor')).toBe(1);
        expect((target as unknown as EventEmitter).listenerCount('unhandledRejection')).toBe(1);
    });
});
