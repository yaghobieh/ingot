import type { Metadata } from 'next';
import { UsageView } from '@/views/UsageView';

export const metadata: Metadata = { title: 'Usage' };

export default function UsagePage() {
    return <UsageView />;
}
