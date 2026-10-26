import * as React from '@theia/core/shared/react';
import type { ZaprexPose } from '../../common/bot/bot.utils';
import { zaprexMascotSvg } from './zaprex-mascot';
import { ZAPREX_ARM_URI, ZAPREX_BODY_URI } from './zaprex-mascot-assets';

/**
 * The living Zaprex T-rex in the panel. The SVG is built once; a pose change only flips `data-state`, so the animation
 * does not restart on every poll. prefers-reduced-motion stops all motion (the SVG's own CSS).
 */
export function ZaprexMascotView({ pose, size }: { pose: ZaprexPose; size: number }): React.ReactElement {
    const host = React.useRef<HTMLSpanElement>(null);
    const markup = React.useMemo(() => zaprexMascotSvg({ body: ZAPREX_BODY_URI, arm: ZAPREX_ARM_URI, state: 'idle', id: 'zxide' }), []);
    React.useEffect(() => {
        const svg = host.current?.querySelector('svg');
        if (svg) { svg.dataset.state = pose; }
    }, [pose, markup]);
    return <span ref={host} id='ingot-zaprex-mascot' className='ingot-zaprex-mascot' data-state={pose} style={{ width: size, height: size }} aria-hidden='true' dangerouslySetInnerHTML={{ __html: markup }} />;
}
