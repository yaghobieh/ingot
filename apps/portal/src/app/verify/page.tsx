import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROUTES } from '@/constants/app.consts';
import { SiteHeader } from '@components/SiteHeader';
import { VerifyForm } from '@components/VerifyForm';
import { safeNext } from '@server/http/cookies';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verify' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
    const params = await searchParams;
    if (!params.email) { redirect(ROUTES.signIn); }
    return (
        <>
            <SiteHeader signedIn={false} />
            <div className="auth-wrap"><VerifyForm email={params.email} next={safeNext(params.next, ROUTES.dashboard)} /></div>
        </>
    );
}
