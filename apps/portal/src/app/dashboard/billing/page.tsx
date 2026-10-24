import type { Metadata } from 'next';
import { BillingView } from '@/views/BillingView';

export const metadata: Metadata = { title: 'Plan & billing' };

export default function BillingPage() {
    return <BillingView />;
}
