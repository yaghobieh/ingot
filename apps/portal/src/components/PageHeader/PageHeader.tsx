import type { PageHeaderProps } from '@components/PageHeader/PageHeader.types';

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
    return (
        <div className="page-head">
            <div>
                <h1 data-testid="page-title">{title}</h1>
                {subtitle ? <p className="muted">{subtitle}</p> : null}
            </div>
            <span className="spacer" />
            {actions}
        </div>
    );
}
