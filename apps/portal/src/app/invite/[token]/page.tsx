import type { Metadata } from 'next';
import { InviteView } from '@/views/InviteView';
import { SiteHeader } from '@components/SiteHeader';
import { getCurrentUser } from '@server/http/auth';
import { inviteDetails } from '@server/services/team.service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Team invitation' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const [user, invite] = await Promise.all([getCurrentUser(), inviteDetails(token)]);
    return (
        <>
            <SiteHeader signedIn={Boolean(user)} />
            <div className="auth-wrap"><InviteView token={token} invite={invite ?? null} userEmail={user?.email ?? null} /></div>
        </>
    );
}
