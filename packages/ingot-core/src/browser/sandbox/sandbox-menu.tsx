import * as React from '@theia/core/shared/react';
import { Backdrop } from '../agents/chat-popovers';
import { APPROVAL_INFO, APPROVAL_MODES, NETWORK_DESCRIPTION, NETWORK_LABEL, POLICY_FILE, SANDBOX_INFO, SANDBOX_MODES } from '../../common/sandbox/sandbox.consts';
import type { SandboxPreset } from '../../common/sandbox/sandbox.types';
import { SANDBOX_MENU_ID } from './sandbox.browser-consts';

export interface SandboxMenuProps {
    readonly preset: SandboxPreset;
    readonly onChange: (preset: SandboxPreset) => void;
    readonly onClose: () => void;
}

/** IDEA-288: the composer's sandbox and approvals picker (saved per project in `.ingot/policy.json`). */
export const SandboxMenu = ({ preset, onChange, onClose }: SandboxMenuProps): React.ReactElement => <>
    <Backdrop onClose={onClose} />
    <div id={SANDBOX_MENU_ID} className='ingot-popover ingot-sandbox-menu' role='menu' tabIndex={-1} ref={el => el?.focus()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className='ingot-sandbox-heading'>Sandbox</div>
        {SANDBOX_MODES.map(mode => (
            <button key={mode} type='button' role='menuitemradio' aria-checked={preset.sandbox === mode} id={`ingot-sandbox-mode-${mode}`}
                className={`ingot-sandbox-item${preset.sandbox === mode ? ' selected' : ''}`} data-mode={mode}
                onClick={() => onChange({ ...preset, sandbox: mode })}>
                <span className={`codicon codicon-${SANDBOX_INFO[mode].icon} ingot-sandbox-icon`} />
                <span className='ingot-sandbox-text'><span className='ingot-sandbox-label'>{SANDBOX_INFO[mode].label}</span><span className='ingot-sandbox-desc'>{SANDBOX_INFO[mode].description}</span></span>
                {preset.sandbox === mode && <span className='codicon codicon-check ingot-sandbox-check' />}
            </button>
        ))}
        {preset.sandbox === 'workspace-write' && <label className='ingot-sandbox-network' title={NETWORK_DESCRIPTION}>
            <input type='checkbox' id='ingot-sandbox-network' checked={preset.network} onChange={e => onChange({ ...preset, network: e.currentTarget.checked })} />
            <span className='ingot-sandbox-text'><span className='ingot-sandbox-label'>{NETWORK_LABEL}</span><span className='ingot-sandbox-desc'>{preset.network ? NETWORK_DESCRIPTION : 'Off: commands that need the network ask first.'}</span></span>
        </label>}
        <div className='ingot-sandbox-heading'>Approvals</div>
        {APPROVAL_MODES.map(mode => (
            <button key={mode} type='button' role='menuitemradio' aria-checked={preset.approvals === mode} id={`ingot-sandbox-approvals-${mode}`}
                className={`ingot-sandbox-item${preset.approvals === mode ? ' selected' : ''}`} data-approvals={mode}
                onClick={() => onChange({ ...preset, approvals: mode })}>
                <span className='ingot-sandbox-text'><span className='ingot-sandbox-label'>{APPROVAL_INFO[mode].label}</span><span className='ingot-sandbox-desc'>{APPROVAL_INFO[mode].description}</span></span>
                {preset.approvals === mode && <span className='codicon codicon-check ingot-sandbox-check' />}
            </button>
        ))}
        <div className='ingot-popover-footer ingot-dim'>Saved for this project in {POLICY_FILE}</div>
    </div>
</>;
