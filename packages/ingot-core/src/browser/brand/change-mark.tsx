import * as React from '@theia/core/shared/react';
import { CHANGE_MARK_DEFAULT_SIZE, CHANGE_MARK_LEFT as LEFT, CHANGE_MARK_RIGHT as RIGHT, CHANGE_MARK_TONE as T } from './change-mark.consts';

export interface ChangeMarkProps {
    size?: number;
    className?: string;
    /** Keep shimmering while the edit streams. */
    loop?: boolean;
    /** Settled: the static mark, no intro animation. */
    still?: boolean;
}

/**
 * IDEA-102: the blue animated </> mark on code-change blocks. Same shapes and CSS animation classes as the brand
 * AnimatedMark (style/brand.css), in its own component so the brand mark's palette stays owned by the brand ticket.
 */
export const ChangeMark = ({ size = CHANGE_MARK_DEFAULT_SIZE, className = '', loop = false, still = false }: ChangeMarkProps): React.ReactElement => {
    const id = React.useMemo(() => `cm${Math.random().toString(36).slice(2, 8)}`, []);
    const shapes = <><path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' /></>;
    return <svg className={`ingot-mark ingot-mark-blue ${loop ? 'ingot-mark-loop' : ''} ${still ? 'ingot-mark-still' : ''} ${className}`} viewBox='0 0 1024 1024' width={size} height={size} role='img' aria-label='Code change'>
        <defs>
            <linearGradient id={`${id}-fill`} x1='0' y1='0' x2='1' y2='1'>
                <stop offset='0' stopColor={T.stops[0]} /><stop offset='.5' stopColor={T.stops[1]} /><stop offset='1' stopColor={T.stops[2]} />
            </linearGradient>
            <linearGradient id={`${id}-shine`} x1='0' y1='0' x2='1' y2='.3'>
                <stop offset='0' stopColor={T.shine} stopOpacity='0' /><stop offset='.5' stopColor={T.shine} stopOpacity='.95' /><stop offset='1' stopColor={T.shine} stopOpacity='0' />
            </linearGradient>
            <filter id={`${id}-glow`} x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='28' /></filter>
            <mask id={`${id}-mask`}><g fill='none' stroke='#fff' strokeWidth='92' strokeLinecap='round' strokeLinejoin='round'>{shapes}</g></mask>
        </defs>
        <g fill='none' strokeLinecap='round' strokeLinejoin='round'>
            <g className='im-glow' stroke={T.glow} strokeWidth='116' filter={`url(#${id}-glow)`}>{shapes}</g>
            <g stroke={T.outline} strokeOpacity='.92' strokeWidth='110'>{shapes}</g>
            <g stroke={`url(#${id}-fill)`} strokeWidth='92'>{shapes}</g>
        </g>
        <g mask={`url(#${id}-mask)`}><rect className='im-shine' x='-400' y='0' width='360' height='1024' fill={`url(#${id}-shine)`} /></g>
        <g className='im-dots' stroke={T.outline} strokeWidth='10'>
            <circle cx='452' cy='512' r='30' fill={T.dots[0]} /><circle cx='512' cy='512' r='30' fill={T.dots[1]} /><circle cx='572' cy='512' r='30' fill={T.dots[2]} />
        </g>
    </svg>;
};
