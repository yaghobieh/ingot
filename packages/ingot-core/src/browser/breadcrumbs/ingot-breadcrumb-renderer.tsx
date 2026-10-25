import * as React from '@theia/core/shared/react';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Breadcrumb, BreadcrumbRenderer } from '@theia/core/lib/browser/breadcrumbs';
import { BreadcrumbHover } from './breadcrumb-hover';

/** Breadcrumb segment with an info hover instead of the plain title tooltip (IDEA-76). */
@injectable()
export class IngotBreadcrumbRenderer implements BreadcrumbRenderer {

    @inject(BreadcrumbHover) protected readonly hover: BreadcrumbHover;

    render(breadcrumb: Breadcrumb, onMouseDown?: (breadcrumb: Breadcrumb, event: React.MouseEvent) => void): React.ReactNode {
        return <li key={breadcrumb.id} className={`theia-breadcrumb-item${onMouseDown ? ' theia-breadcrumb-item-haspopup' : ''} ${breadcrumb.containerClass ?? ''}`}
            tabIndex={0} data-breadcrumb-id={breadcrumb.id} aria-label={breadcrumb.longLabel}
            onMouseDown={event => onMouseDown?.(breadcrumb, event)}
            onMouseEnter={event => { this.hover.show(breadcrumb, event.currentTarget); }}>
            {breadcrumb.iconClass && <span className={breadcrumb.iconClass} />}
            <span className='ingot-bc-label'>{breadcrumb.label}</span>
        </li>;
    }
}
