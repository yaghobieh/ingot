import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROUTES } from '@/constants/app.consts';
import { SettingsView } from '@/views/SettingsView';
import { getCurrentUser } from '@server/http/auth';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
    const user = await getCurrentUser();
    if (!user) { redirect(ROUTES.signIn); }
    return <SettingsView user={user} />;
}
