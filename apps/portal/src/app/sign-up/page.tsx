import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROUTES } from '@/constants/app.consts';
import { AuthForm } from '@components/AuthForm';
import { SiteHeader } from '@components/SiteHeader';
import { getCurrentUser } from '@server/http/auth';
import { safeNext } from '@server/http/cookies';
import { authProviders } from '@server/services/oauth.service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign up' };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
    const params = await searchParams;
    const next = safeNext(params.next, ROUTES.dashboard);
    if (await getCurrentUser().catch(() => undefined)) { redirect(next); }
    return (
        <>
            <SiteHeader signedIn={false} />
            <div className="auth-wrap"><AuthForm mode="sign-up" providers={authProviders()} next={next} initialError={params.error} /></div>
        </>
    );
}
