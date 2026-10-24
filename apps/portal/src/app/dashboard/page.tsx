import type { Metadata } from 'next';
import { OverviewView } from '@/views/OverviewView';
import { getConfig } from '@server/config/config';

export const metadata: Metadata = { title: 'Overview' };

export default function OverviewPage() {
    return <OverviewView sampleData={getConfig().features.sampleData} />;
}
