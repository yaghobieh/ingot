import type { ReactNode } from 'react';
import type { PublicUser } from '@/types/domain.types';

export interface DashboardShellProps {
    user: PublicUser;
    children: ReactNode;
}
