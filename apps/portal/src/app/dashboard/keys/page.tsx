import type { Metadata } from 'next';
import { KeysView } from '@/views/KeysView';

export const metadata: Metadata = { title: 'API keys' };

export default function KeysPage() {
    return <KeysView />;
}
