import type { Metadata } from 'next';
import { TeamView } from '@/views/TeamView';
import { getCurrentUser } from '@server/http/auth';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
    const user = await getCurrentUser();
    return <TeamView me={{ id: user?.id ?? '' }} />;
}
