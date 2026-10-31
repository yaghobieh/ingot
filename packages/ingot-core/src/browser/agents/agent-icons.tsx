import * as React from '@theia/core/shared/react';
import { AGENT_ICON_CLOCK, AGENT_ICON_DOTS, AGENT_ICON_PATHS, AGENT_ICON_SIZE, AGENT_ICON_STROKE, AGENT_ICON_VIEWBOX } from './agent-icons.consts';

interface IconProps {
    readonly size?: number;
    readonly className?: string;
}

const stroked = (size: number, width: number, className: string | undefined, children: React.ReactNode): React.ReactElement =>
    <svg className={`ingot-agent-icon ${className ?? ''}`} width={size} height={size} viewBox={AGENT_ICON_VIEWBOX} fill='none' stroke='currentColor'
        strokeWidth={width} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{children}</svg>;

export const CheckIcon = ({ size = AGENT_ICON_SIZE.check, className }: IconProps): React.ReactElement =>
    stroked(size, AGENT_ICON_STROKE.bold, className, <path d={AGENT_ICON_PATHS.check} />);

export const PlusIcon = ({ size = AGENT_ICON_SIZE.header, className }: IconProps): React.ReactElement =>
    stroked(size, AGENT_ICON_STROKE.thin, className, <path d={AGENT_ICON_PATHS.plus} />);

export const HistoryIcon = ({ size = AGENT_ICON_SIZE.header, className }: IconProps): React.ReactElement =>
    stroked(size, AGENT_ICON_STROKE.thin, className, <><circle {...AGENT_ICON_CLOCK} /><path d={AGENT_ICON_PATHS.clockHands} /></>);

export const MoreIcon = ({ size = AGENT_ICON_SIZE.header, className }: IconProps): React.ReactElement =>
    <svg className={`ingot-agent-icon ${className ?? ''}`} width={size} height={size} viewBox={AGENT_ICON_VIEWBOX} fill='currentColor' aria-hidden='true'>
        {AGENT_ICON_DOTS.xs.map(cx => <circle key={cx} cx={cx} cy={AGENT_ICON_DOTS.cy} r={AGENT_ICON_DOTS.r} />)}
    </svg>;

export const ChevronIcon = ({ size = AGENT_ICON_SIZE.chevron, className, open = true }: IconProps & { readonly open?: boolean }): React.ReactElement =>
    stroked(size, AGENT_ICON_STROKE.bold, className, <path d={open ? AGENT_ICON_PATHS.chevronDown : AGENT_ICON_PATHS.chevronRight} />);

export const AttachIcon = ({ size = AGENT_ICON_SIZE.header, className }: IconProps): React.ReactElement =>
    stroked(size, AGENT_ICON_STROKE.thin, className, <path d={AGENT_ICON_PATHS.attach} />);

export const SendIcon = ({ size = AGENT_ICON_SIZE.send, className }: IconProps): React.ReactElement =>
    stroked(size, AGENT_ICON_STROKE.bold, className, <path d={AGENT_ICON_PATHS.send} />);
