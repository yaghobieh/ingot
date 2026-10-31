import * as React from '@theia/core/shared/react';
import {
    REX_MARK_DEFAULT_SIZE, REX_MARK_GLOW_BLUR, REX_MARK_LEFT, REX_MARK_RIGHT, REX_MARK_SLASH, REX_MARK_STROKE, REX_MARK_VIEWBOX
} from './rex-mark.consts';

export interface RexMarkProps {
    size?: number;
    className?: string;
    /** Accessible name; without it the mark is decorative (next to a visible label). */
    label?: string;
}

/**
 * The Rex / agent icon: the glowing blue </> glyph alone, on a transparent background (no tile, no colored box).
 * Static art of the app icon; colors come from the --ingot-rex-* tokens (style/brand.css).
 */
export const RexMark = ({ size = REX_MARK_DEFAULT_SIZE, className = '', label }: RexMarkProps): React.ReactElement => {
    const id = React.useMemo(() => `rx${Math.random().toString(36).slice(2, 8)}`, []);
    const shapes = <><path d={REX_MARK_LEFT} /><path d={REX_MARK_RIGHT} /><line {...REX_MARK_SLASH} /></>;
    const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
    return <svg className={`ingot-rex-mark ${className}`} viewBox={REX_MARK_VIEWBOX} width={size} height={size} {...a11y}>
        <defs>
            <linearGradient id={`${id}-fill`} x1='0' y1='0' x2='1' y2='1'>
                <stop offset='0' className='ingot-rex-stop-light' /><stop offset='.5' className='ingot-rex-stop-mid' /><stop offset='1' className='ingot-rex-stop-deep' />
            </linearGradient>
            <filter id={`${id}-glow`} x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation={REX_MARK_GLOW_BLUR} /></filter>
        </defs>
        <g fill='none' strokeLinecap='round' strokeLinejoin='round'>
            <g className='ingot-rex-glow' strokeWidth={REX_MARK_STROKE.glow} filter={`url(#${id}-glow)`}>{shapes}</g>
            <g className='ingot-rex-edge' strokeWidth={REX_MARK_STROKE.edge}>{shapes}</g>
            <g stroke={`url(#${id}-fill)`} strokeWidth={REX_MARK_STROKE.fill}>{shapes}</g>
        </g>
    </svg>;
};
