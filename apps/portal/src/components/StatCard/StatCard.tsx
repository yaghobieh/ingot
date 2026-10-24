import type { StatCardProps } from '@components/StatCard/StatCard.types';

export function StatCard({ label, value, hint, testId }: StatCardProps) {
    return (
        <div className="panel" data-testid={testId}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
            {hint ? <div className="muted">{hint}</div> : null}
        </div>
    );
}
