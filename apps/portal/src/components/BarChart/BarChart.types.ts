export interface BarSeries {
    label: string;
    values: number[];
    className: 'bar' | 'bar-alt';
}

export interface BarChartProps {
    labels: string[];
    series: BarSeries[];
    format: (value: number) => string;
    testId: string;
    ariaLabel: string;
    /** viewBox width; use a smaller value for half-width panels so text keeps its size. */
    width?: number;
}
