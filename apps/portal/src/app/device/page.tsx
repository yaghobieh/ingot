import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROUTES } from '@/constants/app.consts';
import { DeviceView } from '@/views/DeviceView';
import { SiteHeader } from '@components/SiteHeader';
import { getCurrentUser } from '@server/http/auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in from Ingot' };

export default async function DevicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
    const { code = '' } = await searchParams;
    const user = await getCurrentUser();
    if (!user) {
        const next = code ? `${ROUTES.device}?code=${encodeURIComponent(code)}` : ROUTES.device;
        redirect(`${ROUTES.signIn}?next=${encodeURIComponent(next)}`);
    }
    return (
        <>
            <SiteHeader signedIn />
            <div className="auth-wrap"><DeviceView initialCode={code} /></div>
        </>
    );
}
