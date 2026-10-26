import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { SETTINGS_PREFS } from '../../common/settings/settings.consts';
import { THEME_IDS } from '../../common/theme/theme.consts';
import { PREVIEW_DEBOUNCE_MS, SWATCH_DEBOUNCE_MS } from '../../common/theme/theme-store.consts';
import type { PickerTheme, StoreInstalledTheme, StoreThemeExtension, ThemeSlot, ThemeSwatch } from '../../common/theme/theme-store.types';
import { formatCount, groupThemes, swatchOf } from '../../common/theme/theme-store.utils';
import { AppearanceContribution } from './appearance-contribution';
import { ThemeStoreService } from './theme-store-service';
import { UserThemeContribution } from './user-theme-contribution';

export const ThemePickerDialogProps = Symbol('ThemePickerDialogProps');

type View = 'installed' | 'browse';
type SwatchState = ThemeSwatch | 'loading' | 'error';

const SLOT_LABELS: Record<ThemeSlot, string> = { light: 'System Light', dark: 'System Dark' };
const BUILT_IN = new Set<string>(Object.values(THEME_IDS));

const Swatch = ({ swatch }: { swatch: ThemeSwatch }) => <span className='ingot-theme-swatch' aria-hidden='true' style={{ background: swatch.background }}>
    <span style={{ background: swatch.foreground }} />
    {swatch.syntax.slice(0, 3).map(c => <span key={c} style={{ background: c }} />)}
    <span style={{ background: swatch.accent }} />
</span>;

/**
 * IDEA-144: theme picker over the workbench. Hover or arrow keys preview a theme live; Apply keeps it, Cancel / Esc reverts.
 * In System mode the user picks one theme for System Light and one for System Dark.
 */
@injectable()
export class ThemePickerDialog extends ReactDialog<string | undefined> {

    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(AppearanceContribution) protected readonly appearance: AppearanceContribution;
    @inject(ThemeStoreService) protected readonly store: ThemeStoreService;
    @inject(UserThemeContribution) protected readonly userThemes: UserThemeContribution;
    @inject(MessageService) protected readonly messages: MessageService;

    protected view: View = 'installed';
    protected query = '';
    protected slot: ThemeSlot | undefined;
    protected original = '';
    protected active: string | undefined;
    protected applied = false;
    protected installed = new Map<string, StoreInstalledTheme>();
    protected results: StoreThemeExtension[] | undefined;
    protected storeError: string | undefined;
    protected storeLoading = false;
    protected installedExtensions = new Set<string>();
    protected busy = new Set<string>();
    protected swatches = new Map<string, SwatchState>();
    protected previewTimer: ReturnType<typeof setTimeout> | undefined;
    protected swatchTimer: ReturnType<typeof setTimeout> | undefined;
    protected searchTimer: ReturnType<typeof setTimeout> | undefined;
    protected searchAbort: AbortController | undefined;

    constructor(@inject(ThemePickerDialogProps) props: DialogProps) {
        super(props);
    }

    @postConstruct()
    protected init(): void {
        this.node.classList.add('ingot-theme-picker-dialog');
        this.node.id = 'ingot-theme-picker-dialog';
        this.appendCloseButton('Cancel');
        this.appendAcceptButton('Apply');
        this.closeButton!.id = 'ingot-theme-picker-cancel';
        this.acceptButton!.id = 'ingot-theme-picker-apply';
        this.toDispose.push(this.userThemes.onDidChange(() => void this.refreshInstalled()));
    }

    get value(): string | undefined {
        return this.active;
    }

    /** Opens the picker; resolves with the applied theme id, or undefined when cancelled. */
    async pick(): Promise<string | undefined> {
        if (this.isAttached) {
            this.activate();
            return undefined;
        }
        this.original = this.themes.getCurrentTheme().id;
        this.slot = this.appearance.activeSlot;
        this.active = this.slot ? this.appearance.slotTheme(this.slot) : this.original;
        this.applied = false;
        this.view = 'installed';
        this.query = '';
        await this.refreshInstalled();
        this.update();
        return this.open(false);
    }

    protected override async accept(): Promise<void> {
        const chosen = this.active;
        if (chosen && this.resolve) {
            this.applied = true;
            this.clearTimers();
            if (this.slot) {
                await this.appearance.setSlotTheme(this.slot, chosen);
            } else {
                this.themes.setCurrentTheme(chosen, false);
                await this.preferences.set(SETTINGS_PREFS.colorTheme, chosen, PreferenceScope.User);
            }
        }
        return super.accept();
    }

    override close(): void {
        this.clearTimers();
        if (!this.applied && this.original && this.themes.getCurrentTheme().id !== this.original) {
            this.themes.setCurrentTheme(this.original, false);
        }
        super.close();
    }

    protected override handleEnter(event: KeyboardEvent): boolean | void {
        if (this.view === 'browse') {
            return false;
        }
        return super.handleEnter(event);
    }

    protected clearTimers(): void {
        clearTimeout(this.previewTimer);
        clearTimeout(this.swatchTimer);
        clearTimeout(this.searchTimer);
        this.searchAbort?.abort();
    }

    protected async refreshInstalled(): Promise<void> {
        const list = await this.userThemes.load();
        this.installed = new Map(list.map(t => [t.id, t]));
        this.installedExtensions = new Set(list.flatMap(t => t.source ? [t.source.extensionId] : []));
        this.update();
    }

    protected pickerThemes(): PickerTheme[] {
        return this.themes.getThemes().map(t => {
            const own = this.installed.get(t.id);
            const description = own?.source ? own.source.publisher : own ? 'Imported' : BUILT_IN.has(t.id) ? 'Ingot' : undefined;
            return { id: t.id, label: t.label, uiTheme: t.type === 'light' ? 'vs' : t.type === 'hcLight' ? 'hc-light' : t.type === 'hc' ? 'hc-black' : 'vs-dark',
                description, removable: !!own, extensionId: own?.source?.extensionId };
        });
    }

    /** Live preview (debounced so moving the mouse across the list stays smooth). */
    protected preview(themeId: string, immediate = false): void {
        this.active = themeId;
        clearTimeout(this.previewTimer);
        const run = () => {
            if (this.themes.getCurrentTheme().id !== themeId) {
                this.themes.setCurrentTheme(themeId, false);
            }
        };
        if (immediate) {
            run();
        } else {
            this.previewTimer = setTimeout(run, PREVIEW_DEBOUNCE_MS);
        }
        this.update();
    }

    protected chooseSlot(slot: ThemeSlot): void {
        this.slot = slot;
        this.preview(this.appearance.slotTheme(slot), true);
    }

    protected showBrowse(): void {
        this.view = 'browse';
        this.update();
        this.searchStore(0);
    }

    protected searchStore(delay = 300): void {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(async () => {
            this.searchAbort?.abort();
            const abort = this.searchAbort = new AbortController();
            this.storeLoading = true;
            this.storeError = undefined;
            this.update();
            try {
                const results = await this.store.search(this.query, abort.signal);
                if (!abort.signal.aborted) {
                    this.results = results;
                }
            } catch (error) {
                if (!abort.signal.aborted) {
                    this.storeError = `Could not reach Open VSX: ${error instanceof Error ? error.message : String(error)}`;
                }
            } finally {
                if (!abort.signal.aborted) {
                    this.storeLoading = false;
                    this.update();
                }
            }
        }, delay);
    }

    protected loadSwatch(extension: StoreThemeExtension): void {
        if (this.swatches.has(extension.id)) {
            return;
        }
        clearTimeout(this.swatchTimer);
        this.swatchTimer = setTimeout(async () => {
            this.swatches.set(extension.id, 'loading');
            this.update();
            try {
                const swatch = await this.store.swatch(extension);
                this.swatches.set(extension.id, swatch ?? 'error');
            } catch {
                this.swatches.set(extension.id, 'error');
            }
            this.update();
        }, SWATCH_DEBOUNCE_MS);
    }

    protected async install(extension: StoreThemeExtension): Promise<void> {
        this.busy.add(extension.id);
        this.update();
        try {
            const themes = await this.store.install(extension);
            await this.refreshInstalled();
            // Install, then preview: back to the list with the new theme active (Apply keeps it).
            this.view = 'installed';
            this.query = '';
            this.preview(themes[0].id, true);
        } catch (error) {
            this.messages.error(`Could not install ${extension.displayName}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.busy.delete(extension.id);
            this.update();
        }
    }

    protected async uninstall(extensionId: string | undefined, themeId: string): Promise<void> {
        const removed = extensionId ? await this.store.uninstall(extensionId) : await this.userThemes.uninstall({ themeId });
        await this.refreshInstalled();
        if (removed.includes(this.original)) {
            this.original = this.themes.getCurrentTheme().id;
        }
        if (this.active && removed.includes(this.active)) {
            this.preview(this.slot ? (this.slot === 'light' ? THEME_IDS.light : THEME_IDS.dark) : this.original, true);
        }
    }

    protected onSearchKey(event: React.KeyboardEvent<HTMLInputElement>, flat: PickerTheme[]): void {
        if (this.view !== 'installed' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !flat.length) {
            return;
        }
        event.preventDefault();
        const index = flat.findIndex(t => t.id === this.active);
        const next = event.key === 'ArrowDown' ? Math.min(flat.length - 1, index + 1) : Math.max(0, index - 1);
        this.preview(flat[next].id);
        this.node.querySelector(`[data-theme-id="${CSS.escape(flat[next].id)}"]`)?.scrollIntoView({ block: 'nearest' });
    }

    protected render(): React.ReactNode {
        const grouped = groupThemes(this.pickerThemes(), this.view === 'installed' ? this.query : '');
        const flat = [...grouped.light, ...grouped.dark];
        const system = this.appearance.mode === 'system';
        return <div className='ingot-theme-picker' id='ingot-theme-picker' data-view={this.view}>
            <div className='ingot-theme-picker-top'>
                <span className='codicon codicon-search' />
                <input id='ingot-theme-picker-search' className='ingot-theme-picker-search' autoFocus spellCheck={false} value={this.query}
                    placeholder={this.view === 'browse' ? 'Search color themes on Open VSX' : this.slot ? `Select a theme for ${system ? SLOT_LABELS[this.slot] : this.slot === 'light' ? 'Light mode' : 'Dark mode'}` : 'Select a color theme'}
                    onKeyDown={e => this.onSearchKey(e, flat)}
                    onChange={e => {
                        this.query = e.currentTarget.value;
                        if (this.view === 'browse') {
                            this.searchStore();
                        }
                        this.update();
                    }} />
                {system && this.slot && <div className='ingot-theme-slots' role='tablist' aria-label='System theme'>
                    {(['light', 'dark'] as const).map(slot => <button key={slot} type='button' role='tab' id={`ingot-theme-slot-${slot}`} aria-selected={this.slot === slot}
                        className={`ingot-theme-slot${this.slot === slot ? ' selected' : ''}`} onClick={() => this.chooseSlot(slot)}>
                        <span className={`codicon codicon-${slot === 'light' ? 'symbol-color' : 'circle-filled'}`} />{SLOT_LABELS[slot]}
                    </button>)}
                </div>}
            </div>
            {this.view === 'installed' ? this.renderInstalled(grouped.light, grouped.dark) : this.renderBrowse()}
        </div>;
    }

    protected renderInstalled(light: PickerTheme[], dark: PickerTheme[]): React.ReactNode {
        return <div className='ingot-theme-picker-list' role='listbox' aria-label='Installed themes'>
            <button type='button' className='ingot-theme-browse-link' id='ingot-theme-browse' onClick={() => this.showBrowse()}>
                <span className='codicon codicon-add' />Browse themes…
            </button>
            {[['Light themes', light, 'light'], ['Dark themes', dark, 'dark']].map(([title, list, id]) => (list as PickerTheme[]).length > 0 &&
                <div key={id as string} className='ingot-theme-group' id={`ingot-theme-group-${id}`}>
                    <div className='ingot-theme-group-title'>{title as string}</div>
                    {(list as PickerTheme[]).map(theme => this.renderThemeRow(theme))}
                </div>)}
            {!light.length && !dark.length && <div className='ingot-theme-empty'>No installed theme matches “{this.query}”. <a href='#' onClick={e => { e.preventDefault(); this.showBrowse(); }}>Search Open VSX</a></div>}
        </div>;
    }

    protected renderThemeRow(theme: PickerTheme): React.ReactNode {
        const own = this.installed.get(theme.id);
        const swatch = own ? swatchOf(own.json, own.uiTheme) : undefined;
        const active = this.active === theme.id;
        const current = this.slot ? this.appearance.slotTheme(this.slot) === theme.id : this.original === theme.id;
        return <div key={theme.id} role='option' aria-selected={active} data-theme-id={theme.id} tabIndex={-1}
            className={`ingot-theme-row${active ? ' active' : ''}`}
            onMouseEnter={() => this.preview(theme.id)} onClick={() => this.preview(theme.id, true)} onDoubleClick={() => { this.preview(theme.id, true); void this.accept(); }}>
            {swatch ? <Swatch swatch={swatch} /> : <span className={`ingot-theme-dot ${theme.uiTheme === 'vs' || theme.uiTheme === 'hc-light' ? 'light' : 'dark'}`} aria-hidden='true' />}
            <span className='ingot-theme-label'>{theme.label}</span>
            {theme.description && <span className='ingot-theme-description'>{theme.description}</span>}
            <span className='ingot-flex' />
            {current && <span className='codicon codicon-check ingot-theme-current' title='Current' />}
            {theme.removable && <button type='button' className='ingot-theme-uninstall' title='Uninstall' aria-label={`Uninstall ${theme.label}`}
                onClick={e => { e.stopPropagation(); void this.uninstall(theme.extensionId, theme.id); }}>
                <span className='codicon codicon-trash' />
            </button>}
        </div>;
    }

    protected renderBrowse(): React.ReactNode {
        return <div className='ingot-theme-picker-list ingot-theme-store' id='ingot-theme-store'>
            <button type='button' className='ingot-theme-browse-link' id='ingot-theme-back' onClick={() => { this.view = 'installed'; this.query = ''; this.update(); }}>
                <span className='codicon codicon-arrow-left' />Installed themes
            </button>
            {this.storeError && <div className='ingot-theme-empty ingot-theme-error'>{this.storeError}</div>}
            {this.storeLoading && !this.results && <div className='ingot-theme-empty'><span className='codicon codicon-loading codicon-modifier-spin' /> Loading themes…</div>}
            {this.results && !this.results.length && !this.storeLoading && <div className='ingot-theme-empty'>No color themes found.</div>}
            {this.results?.map(ext => this.renderStoreCard(ext))}
        </div>;
    }

    protected renderStoreCard(ext: StoreThemeExtension): React.ReactNode {
        const swatch = this.swatches.get(ext.id);
        const installed = this.installedExtensions.has(ext.id);
        const busy = this.busy.has(ext.id);
        return <div key={ext.id} className='ingot-theme-card' data-extension-id={ext.id} onMouseEnter={() => this.loadSwatch(ext)}>
            <div className='ingot-theme-card-art'>
                {swatch && typeof swatch === 'object' ? <Swatch swatch={swatch} />
                    : ext.iconUrl ? <img src={ext.iconUrl} alt='' loading='lazy' /> : <span className='codicon codicon-symbol-color' />}
            </div>
            <div className='ingot-theme-card-text'>
                <div className='ingot-theme-card-name' title={ext.description}>{ext.displayName}</div>
                <div className='ingot-theme-card-meta'>
                    <span>{ext.namespace}</span>
                    <span title={`${ext.downloads} downloads`}><span className='codicon codicon-cloud-download' />{formatCount(ext.downloads)}</span>
                    {ext.rating !== undefined && <span title={`${ext.reviewCount} reviews`}><span className='codicon codicon-star-full' />{ext.rating.toFixed(1)}</span>}
                </div>
            </div>
            {installed
                ? <>
                    <span className='ingot-theme-installed'><span className='codicon codicon-check' />Installed</span>
                    <button type='button' className='ingot-btn-ghost ingot-theme-card-uninstall' onClick={() => void this.uninstall(ext.id, '')}>Uninstall</button>
                </>
                : <button type='button' className='ingot-btn-primary ingot-theme-install' disabled={busy} onClick={() => void this.install(ext)}>{busy ? 'Installing…' : 'Install'}</button>}
        </div>;
    }
}
