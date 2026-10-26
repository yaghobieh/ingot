import * as React from '@theia/core/shared/react';
import type { IngotAccount } from '../../common/account/account.types';
import { accountInitials } from '../../common/account/account.utils';

export interface AccountAvatarProps {
    readonly account: IngotAccount;
    /** Cached data URL or https URL; '' shows initials. */
    readonly src: string;
    readonly id?: string;
    readonly className?: string;
    /** Initials drawn by CSS (attr) so they never end up in the surrounding text, e.g. a chat message. */
    readonly textless?: boolean;
}

/** IDEA-143: Google / GitHub photo with an initials fallback (also when the photo fails to load). */
export function AccountAvatar({ account, src, id, className = '', textless }: AccountAvatarProps): React.ReactElement {
    const [broken, setBroken] = React.useState('');
    const initials = accountInitials(account);
    if (src && broken !== src) {
        return <img id={id} className={`ingot-avatar ingot-avatar-img ${className}`} src={src} alt='' draggable={false}
            referrerPolicy='no-referrer' data-kind='photo' onError={() => setBroken(src)} />;
    }
    return <span id={id} className={`ingot-avatar ${className}`} data-kind='initials' data-initials={initials} aria-hidden='true'>{textless ? '' : initials}</span>;
}
