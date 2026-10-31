import type { SlackConnectionService } from './slack-connection-service';

export interface SlackConnectionCardProps {
    readonly service: SlackConnectionService;
    readonly onOpenApps: () => void;
    /** Bumped to open the token field (the marketplace's Slack "Add" lands here). */
    readonly connectRequest?: number;
}
