import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { IngotModelClient } from './model-client';
import { MODEL_CATALOG, MODEL_PREFERENCES, PROVIDERS } from '../../common/models/models.consts';
import type { ProviderId, ProviderInfo } from '../../common/models/models.types';
import { MODELS_WIDGET_ID, MODELS_WIDGET_LABEL } from './models.browser-consts';

/** Settings › Models: bring your own keys (OS keychain), local Ollama, and inline completion (IDEA-26). */
@injectable()
export class IngotModelsWidget extends ReactWidget {

    @inject(IngotModelClient) protected readonly client: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected readonly drafts = new Map<ProviderId, string>();
    protected readonly results = new Map<ProviderId, { ok: boolean; text: string }>();
    protected readonly busy = new Set<ProviderId>();
    /** Preference writes still in flight; Test waits for them so it uses the values just typed. */
    protected saving: Promise<unknown> = Promise.resolve();

    @postConstruct()
    protected init(): void {
        this.id = MODELS_WIDGET_ID;
        this.title.label = MODELS_WIDGET_LABEL;
        this.title.caption = MODELS_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-ai';
        this.addClass('ingot-models');
        this.toDispose.push(this.client.onDidChange(() => this.update()));
        this.toDispose.push(this.preferences.onPreferenceChanged(e => e.preferenceName.startsWith('ingot.') && this.update()));
        this.client.refresh();
        this.update();
    }

    protected async run(provider: ProviderId, action: () => Promise<string>): Promise<void> {
        this.busy.add(provider);
        this.update();
        try {
            await this.saving;
            this.results.set(provider, { ok: true, text: await action() });
        } catch (error) {
            this.results.set(provider, { ok: false, text: error instanceof Error ? error.message : String(error) });
        } finally {
            this.busy.delete(provider);
            this.update();
        }
    }

    protected saveKey(provider: ProviderId): void {
        const key = this.drafts.get(provider)?.trim();
        if (!key) {
            return;
        }
        this.drafts.delete(provider);
        this.run(provider, async () => {
            await this.client.setKey(provider, key);
            return 'Key saved in your OS keychain.';
        });
    }

    protected setPreference(name: string, value: unknown): void {
        this.saving = Promise.all([this.saving, this.preferences.set(name, value, PreferenceScope.User)]);
    }

    protected setOverride(provider: ProviderId, value: string): void {
        const current = this.preferences.get<Record<string, string>>(MODEL_PREFERENCES.overrides, {});
        const next = { ...current, [provider]: value };
        if (!value.trim()) {
            delete next[provider];
        }
        this.setPreference(MODEL_PREFERENCES.overrides, next);
    }

    protected render(): React.ReactNode {
        const overrides = this.preferences.get<Record<string, string>>(MODEL_PREFERENCES.overrides, {});
        return <div className='ingot-models-root'>
            <h2>Models</h2>
            <p className='ingot-models-lead'>Bring your own keys. Keys are stored in your OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux) — never in settings or project files — and are only sent to the provider's own API.</p>
            {!this.client.secureStorage && <div id='ingot-models-no-keychain' className='ingot-models-warning'>Secure storage is not available on this system, so API keys cannot be saved. Local models (Ollama) still work.</div>}
            <div className='ingot-models-list'>
                {PROVIDERS.map(p => this.renderProvider(p, overrides[p.id] ?? ''))}
            </div>
            <h2>Inline completion</h2>
            <label className='ingot-models-row'>
                <input id='ingot-autocomplete-enabled' type='checkbox' checked={this.preferences.get<boolean>(MODEL_PREFERENCES.autocompleteEnabled, true)}
                    onChange={e => this.setPreference(MODEL_PREFERENCES.autocompleteEnabled, e.currentTarget.checked)} />
                Show ghost-text completions while typing (Tab accepts, Ctrl/⌘+→ accepts the next word, Esc dismisses)
            </label>
            <label className='ingot-models-row'>
                <span className='ingot-models-label'>Completion model</span>
                <select id='ingot-autocomplete-model' className='ingot-select' value={this.preferences.get<string>(MODEL_PREFERENCES.autocompleteModel, '')}
                    onChange={e => this.setPreference(MODEL_PREFERENCES.autocompleteModel, e.currentTarget.value)}>
                    <option value=''>Automatic (first connected)</option>
                    {MODEL_CATALOG.map(m => <option key={m.id} value={m.id}>{m.label}{this.client.isModelConfigured(m.id) ? '' : ' — not connected'}</option>)}
                </select>
            </label>
        </div>;
    }

    protected renderProvider(p: ProviderInfo, override: string): React.ReactNode {
        const configured = this.client.isProviderConfigured(p.id);
        const result = this.results.get(p.id);
        const busy = this.busy.has(p.id);
        return <section key={p.id} id={`ingot-model-${p.id}`} className='ingot-model-card'>
            <div className='ingot-model-head'>
                <span className='ingot-model-name'>{p.label}</span>
                <span id={`ingot-model-status-${p.id}`} className={`ingot-model-status ${configured ? 'ok' : ''}`}>{p.needsKey ? (configured ? 'Key in keychain' : 'No key') : 'Local, no key'}</span>
            </div>
            {p.needsKey
                ? <div className='ingot-models-row'>
                    <input id={`ingot-model-key-${p.id}`} className='theia-input ingot-model-input' type='password' autoComplete='off' spellCheck={false}
                        placeholder={configured ? 'Replace key…' : `API key (${p.keyHint})`} disabled={!this.client.secureStorage || busy}
                        value={this.drafts.get(p.id) ?? ''} onChange={e => { this.drafts.set(p.id, e.currentTarget.value); this.update(); }}
                        onKeyDown={e => e.key === 'Enter' && this.saveKey(p.id)} />
                    <button type='button' id={`ingot-model-save-${p.id}`} className='theia-button' disabled={!this.drafts.get(p.id)?.trim() || busy} onClick={() => this.saveKey(p.id)}>Save</button>
                    {configured && <button type='button' id={`ingot-model-remove-${p.id}`} className='theia-button secondary' disabled={busy}
                        onClick={() => this.run(p.id, async () => { await this.client.deleteKey(p.id); return 'Key removed from your OS keychain.'; })}>Remove</button>}
                </div>
                : <div className='ingot-models-row'>
                    <span className='ingot-models-label'>Server URL</span>
                    <input id='ingot-model-ollama-url' className='theia-input ingot-model-input' defaultValue={this.preferences.get<string>(MODEL_PREFERENCES.ollamaUrl)}
                        onBlur={e => this.setPreference(MODEL_PREFERENCES.ollamaUrl, e.currentTarget.value.trim())} />
                </div>}
            <div className='ingot-models-row'>
                <span className='ingot-models-label'>Model name</span>
                <input id={`ingot-model-override-${p.id}`} className='theia-input ingot-model-input' placeholder={MODEL_CATALOG.filter(m => m.provider === p.id).map(m => m.model).join(', ')}
                    defaultValue={override} onBlur={e => this.setOverride(p.id, e.currentTarget.value.trim())} />
                <button type='button' id={`ingot-model-test-${p.id}`} className='theia-button secondary' disabled={busy || !configured} onClick={() => this.run(p.id, () => this.client.test(p.id))}>{busy ? 'Testing…' : 'Test'}</button>
            </div>
            {result && <div id={`ingot-model-result-${p.id}`} className={`ingot-model-result ${result.ok ? 'ok' : 'error'}`}>{result.text}</div>}
        </section>;
    }
}
