import type { PublicUser, TeamRole } from '@/types/domain.types';

export interface OverviewViewProps {
    sampleData: boolean;
}

export interface TeamViewProps {
    me: Pick<PublicUser, 'id'>;
}

export interface SettingsViewProps {
    user: PublicUser;
}

export interface DeviceViewProps {
    initialCode: string;
}

export interface InviteViewProps {
    token: string;
    invite: { teamName: string; email: string; role: TeamRole } | null;
    userEmail: string | null;
}
