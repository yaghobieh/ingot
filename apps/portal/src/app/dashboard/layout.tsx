import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ROUTES } from '@/constants/app.consts';
import { DashboardShell } from '@components/DashboardShell';
import { getCurrentUser } from '@server/http/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
    const user = await getCurrentUser();
    if (!user) { redirect(`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.dashboard)}`); }
    return <DashboardShell user={user}>{children}</DashboardShell>;
}
