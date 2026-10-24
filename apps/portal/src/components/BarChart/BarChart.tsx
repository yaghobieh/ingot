import {
    CHART_BAR_GAP, CHART_GRID_LINES, CHART_HEIGHT, CHART_LABEL_EVERY_MAX, CHART_PAD_BOTTOM, CHART_PAD_TOP, CHART_PAD_X, CHART_WIDTH
} from '@components/BarChart/BarChart.consts';
import type { BarChartProps } from '@components/BarChart/BarChart.types';

/** Dependency-free stacked bar chart (SVG) that follows the theme tokens. */
export function BarChart({ labels, series, format, testId, ariaLabel, width = CHART_WIDTH }: BarChartProps) {
    const totals = labels.map((_, index) => series.reduce((sum, s) => sum + (s.values[index] ?? 0), 0));
    const max = Math.max(1, ...totals);
    const innerW = width - CHART_PAD_X * 2;
    const innerH = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
    const slot = innerW / Math.max(1, labels.length);
    const barW = slot * (1 - CHART_BAR_GAP);
    const labelEvery = Math.max(1, Math.ceil(labels.length / (CHART_LABEL_EVERY_MAX * width / CHART_WIDTH)));
    const y = (value: number) => CHART_PAD_TOP + innerH - (value / max) * innerH;

    return (
        <svg className="chart" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} role="img" aria-label={ariaLabel} data-testid={testId} direction="ltr">
            {Array.from({ length: CHART_GRID_LINES + 1 }, (_, i) => {
                const value = (max / CHART_GRID_LINES) * i;
                return (
                    <g key={i}>
                        <line className="grid" x1={CHART_PAD_X} x2={width - CHART_PAD_X} y1={y(value)} y2={y(value)} />
                        <text className="axis" x={CHART_PAD_X - 6} y={y(value) + 3} textAnchor="end">{format(value)}</text>
                    </g>
                );
            })}
            {labels.map((label, index) => {
                let base = 0;
                const x = CHART_PAD_X + slot * index + (slot - barW) / 2;
                return (
                    <g key={label}>
                        {series.map(s => {
                            const value = s.values[index] ?? 0;
                            const top = y(base + value);
                            const height = y(base) - top;
                            base += value;
                            return height > 0 ? (
                                <rect key={s.label} className={s.className} x={x} y={top} width={barW} height={height} rx={2}>
                                    <title>{`${label} · ${s.label}: ${format(value)}`}</title>
                                </rect>
                            ) : null;
                        })}
                        {index % labelEvery === 0 ? <text className="axis" x={x + barW / 2} y={CHART_HEIGHT - 6} textAnchor="middle">{label}</text> : null}
                    </g>
                );
            })}
        </svg>
    );
}
