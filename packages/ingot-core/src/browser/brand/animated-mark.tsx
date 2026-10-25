import * as React from '@theia/core/shared/react';

const LEFT = 'M336 300 L124 512 L336 724';
const RIGHT = 'M688 300 L900 512 L688 724';

/**
 * The animated Ingot </> mark (IDEA-63 v3): the brackets open apart, "..." types in, the slash slides in and a
 * gold shimmer sweeps across. CSS-only (style/brand.css); `prefers-reduced-motion` shows the static mark.
 */
const TONES = {
    gold: { stops: ['#F6D58E', '#D9A04E', '#A8752C'], glow: '#D9A04E', outline: '#1B2647', dots: ['#D9A04E', '#3B6FD9', '#D9A04E'] },
    // IDEA-102: the blue mark on code-change blocks and the editor gutter while an edit streams.
    blue: { stops: ['#9CC0FF', '#3B7BF0', '#2350B0'], glow: '#3B7BF0', outline: '#0E1A3A', dots: ['#9CC0FF', '#FFFFFF', '#9CC0FF'] }
};

export interface AnimatedMarkProps {
    size?: number;
    className?: string;
    /** Keep shimmering (agent running / edit streaming). */
    loop?: boolean;
    tone?: keyof typeof TONES;
    /** Settled: the static mark, no intro animation. */
    still?: boolean;
}

export const AnimatedMark = ({ size = 72, className = '', loop = false, tone = 'gold', still = false }: AnimatedMarkProps): React.ReactElement => {
    const t = TONES[tone];
    const id = React.useMemo(() => `im${Math.random().toString(36).slice(2, 8)}`, []);
    return <svg className={`ingot-mark ingot-mark-${tone} ${loop ? 'ingot-mark-loop' : ''} ${still ? 'ingot-mark-still' : ''} ${className}`} viewBox='0 0 1024 1024' width={size} height={size} role='img' aria-label='Ingot'>
        <defs>
            <linearGradient id={`${id}-gold`} x1='0' y1='0' x2='1' y2='1'>
                <stop offset='0' stopColor={t.stops[0]} /><stop offset='.5' stopColor={t.stops[1]} /><stop offset='1' stopColor={t.stops[2]} />
            </linearGradient>
            <linearGradient id={`${id}-shine`} x1='0' y1='0' x2='1' y2='.3'>
                <stop offset='0' stopColor='#FFF8E6' stopOpacity='0' /><stop offset='.5' stopColor='#FFF8E6' stopOpacity='.95' /><stop offset='1' stopColor='#FFF8E6' stopOpacity='0' />
            </linearGradient>
            <filter id={`${id}-glow`} x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='28' /></filter>
            <mask id={`${id}-mask`}><g fill='none' stroke='#fff' strokeWidth='92' strokeLinecap='round' strokeLinejoin='round'>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g></mask>
        </defs>
        <g fill='none' strokeLinecap='round' strokeLinejoin='round'>
            <g className='im-glow' stroke={t.glow} strokeWidth='116' filter={`url(#${id}-glow)`}>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g>
            <g stroke={t.outline} strokeOpacity='.92' strokeWidth='110'>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g>
            <g stroke={`url(#${id}-gold)`} strokeWidth='92'>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g>
        </g>
        <g mask={`url(#${id}-mask)`}><rect className='im-shine' x='-400' y='0' width='360' height='1024' fill={`url(#${id}-shine)`} /></g>
        <g className='im-dots' stroke={t.outline} strokeWidth='10'>
            <circle cx='452' cy='512' r='30' fill={t.dots[0]} /><circle cx='512' cy='512' r='30' fill={t.dots[1]} /><circle cx='572' cy='512' r='30' fill={t.dots[2]} />
        </g>
    </svg>;
};
