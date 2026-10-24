import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { PRODUCT } from '../../common/product.consts';
import { AnimatedMark } from '../brand/animated-mark';

/** Branded Help > About dialog (IDEA-16). */
@injectable()
export class IngotAboutDialog extends AboutDialog {

    protected override renderHeader(): React.ReactNode {
        return <div className='ingot-about-header'>
            <span className='ingot-about-logo ingot-app-icon ingot-mark-host'><AnimatedMark size={72} /></span>
            <div>
                <h1 className='ingot-about-title'>{PRODUCT.name} <span>{PRODUCT.version}</span></h1>
                <p className='ingot-about-tagline'>{PRODUCT.tagline}</p>
                <p className='ingot-about-meta'>{PRODUCT.license} · <a href={PRODUCT.repositoryUrl} onClick={e => { e.preventDefault(); this.doOpenExternalLink(PRODUCT.repositoryUrl); }}>{PRODUCT.repositoryUrl}</a></p>
            </div>
        </div>;
    }
}
