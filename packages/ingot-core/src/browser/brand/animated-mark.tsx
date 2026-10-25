import * as React from '@theia/core/shared/react';

const LEFT = 'M336 300 L124 512 L336 724';
const RIGHT = 'M688 300 L900 512 L688 724';

/**
 * The animated Ingot </> mark (IDEA-63 v3): the brackets open apart, "..." types in, the slash slides in and a
 * gold shimmer sweeps across. CSS-only (style/brand.css); `prefers-reduced-motion` shows the static mark.
 */
export const AnimatedMark = ({ size = 72, className = '', loop = false }: { size?: number; className?: string; loop?: boolean }): React.ReactElement => {
    const id = React.useMemo(() => `im${Math.random().toString(36).slice(2, 8)}`, []);
    return <svg className={`ingot-mark ${loop ? 'ingot-mark-loop' : ''} ${className}`} viewBox='0 0 1024 1024' width={size} height={size} role='img' aria-label='Ingot'>
        <defs>
            <linearGradient id={`${id}-gold`} x1='0' y1='0' x2='1' y2='1'>
                <stop offset='0' stopColor='#8DB2FF' /><stop offset='.5' stopColor='#3B6FD9' /><stop offset='1' stopColor='#2A4FB0' />
            </linearGradient>
            <linearGradient id={`${id}-shine`} x1='0' y1='0' x2='1' y2='.3'>
                <stop offset='0' stopColor='#E3EEFF' stopOpacity='0' /><stop offset='.5' stopColor='#E3EEFF' stopOpacity='.95' /><stop offset='1' stopColor='#E3EEFF' stopOpacity='0' />
            </linearGradient>
            <filter id={`${id}-glow`} x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='28' /></filter>
            <mask id={`${id}-mask`}><g fill='none' stroke='#fff' strokeWidth='92' strokeLinecap='round' strokeLinejoin='round'>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g></mask>
        </defs>
        <g fill='none' strokeLinecap='round' strokeLinejoin='round'>
            <g className='im-glow' stroke='#5E8FFF' strokeWidth='116' filter={`url(#${id}-glow)`}>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g>
            <g stroke='#1B2647' strokeOpacity='.92' strokeWidth='110'>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g>
            <g stroke={`url(#${id}-gold)`} strokeWidth='92'>
                <path className='im-left' d={LEFT} /><path className='im-right' d={RIGHT} /><line className='im-slash' x1='578' y1='250' x2='446' y2='774' />
            </g>
        </g>
        <g mask={`url(#${id}-mask)`}><rect className='im-shine' x='-400' y='0' width='360' height='1024' fill={`url(#${id}-shine)`} /></g>
        <g className='im-dots' stroke='#1B2647' strokeWidth='10'>
            <circle cx='452' cy='512' r='30' fill='#8DB2FF' /><circle cx='512' cy='512' r='30' fill='#E3EEFF' /><circle cx='572' cy='512' r='30' fill='#8DB2FF' />
        </g>
    </svg>;
};
