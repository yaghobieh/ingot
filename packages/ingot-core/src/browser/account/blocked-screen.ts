import { ACCOUNT_TEXT, BLOCKED_SCREEN_ID } from './account.consts';

/**
 * Blocking "This account is blocked" screen (IDEA-124, contract §5). Covers the whole window; the only way out is
 * Sign out (the server already revoked the session). Returns a function that removes it.
 */
export function showBlockedScreen(onSignOut: () => Promise<void> | void, doc: Document = document): () => void {
    doc.getElementById(BLOCKED_SCREEN_ID)?.remove();
    const overlay = doc.createElement('div');
    overlay.id = BLOCKED_SCREEN_ID;
    overlay.className = 'ingot-blocked-screen';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', `${BLOCKED_SCREEN_ID}-title`);
    const card = doc.createElement('div');
    card.className = 'ingot-blocked-card';
    const icon = doc.createElement('span');
    icon.className = 'codicon codicon-error ingot-blocked-icon';
    const title = doc.createElement('h2');
    title.id = `${BLOCKED_SCREEN_ID}-title`;
    title.textContent = ACCOUNT_TEXT.blockedTitle;
    const body = doc.createElement('p');
    body.textContent = ACCOUNT_TEXT.blockedBody;
    const button = doc.createElement('button');
    button.type = 'button';
    button.id = `${BLOCKED_SCREEN_ID}-sign-out`;
    button.className = 'theia-button main';
    button.textContent = ACCOUNT_TEXT.blockedSignOut;
    button.addEventListener('click', () => { button.disabled = true; Promise.resolve(onSignOut()).finally(() => { button.disabled = false; }); });
    card.append(icon, title, body, button);
    overlay.append(card);
    doc.body.append(overlay);
    button.focus();
    return () => overlay.remove();
}
