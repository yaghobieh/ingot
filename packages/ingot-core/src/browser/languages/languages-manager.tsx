import * as React from '@theia/core/shared/react';
import type { GuidePlatform } from '../../common/debug/debug.types';
import { FEATURE_LABELS, LANGUAGE_TEXT, TOOLCHAIN_IDS, TOOLCHAINS } from '../../common/languages/languages.consts';
import type { FeatureReport, FeatureState, LanguageReport, ToolchainId, ToolchainStatus } from '../../common/languages/languages.types';
import { extensionInfo, installCommand } from '../../common/languages/languages.utils';
import type { LanguageSupportStore } from './language-support-store';
import { FEATURE_STATE_ICONS, LANGUAGES_DOM } from './languages.browser-consts';

export interface LanguagesManagerProps {
    readonly store: LanguageSupportStore;
    readonly copy: (text: string) => void;
    readonly openUrl: (url: string) => void;
}

const featureTitle = (report: FeatureReport): string => {
    const extension = report.extension ? extensionInfo(report.extension) : undefined;
    const missing = report.missing.map(id => TOOLCHAINS[id].label).join(', ');
    return [
        `${FEATURE_LABELS[report.feature]}: ${LANGUAGE_TEXT.states[report.state]}${missing ? ` ${missing}` : ''}`,
        extension ? `${extension.label} (${extension.id}, ${extension.licence})` : '',
        report.note ?? ''
    ].filter(Boolean).join('\n');
};

const toolchainLabel = (status: ToolchainStatus | undefined): string => {
    if (!status?.found) {
        return 'Missing';
    }
    const version = status.version ? ` ${status.version}` : '';
    if (status.tooOld) {
        return `Too old${version}`;
    }
    return status.bundled ? `Bundled${version}` : `Found${version}`;
};

const FeatureCell = ({ report }: { readonly report: FeatureReport }): React.ReactElement =>
    <td className={`ingot-lang-feature ingot-lang-${report.state}`} data-feature={report.feature} data-state={report.state} title={featureTitle(report)}>
        <span className={`codicon codicon-${FEATURE_STATE_ICONS[report.state]}`} aria-label={LANGUAGE_TEXT.states[report.state]} />
    </td>;

/** IDEA-313: Settings › Languages: what each language can do here, its extensions with licences, and what to install. */
export const LanguagesManager = ({ store, copy, openUrl }: LanguagesManagerProps): React.ReactElement => {
    const [, setVersion] = React.useState(0);
    const [open, setOpen] = React.useState<string | undefined>();
    const [busy, setBusy] = React.useState(false);
    React.useEffect(() => {
        const listener = store.onDidChange(() => setVersion(v => v + 1));
        void store.load();
        return () => listener.dispose();
    }, [store]);

    const refresh = async (): Promise<void> => {
        setBusy(true);
        try {
            await store.refresh();
        } finally {
            setBusy(false);
        }
    };

    if (!store.loaded) {
        return <section className='ingot-settings-card ingot-languages' id={LANGUAGES_DOM.root}>
            <p className='ingot-dim' id={LANGUAGES_DOM.loading}>Checking languages and toolchains…</p>
        </section>;
    }
    const { reports, platform } = store;
    const count = (level: LanguageReport['level']): number => reports.filter(r => r.level === level).length;

    return <section className='ingot-settings-card ingot-languages' id={LANGUAGES_DOM.root}>
        <div className='ingot-languages-summary'>
            <span id={LANGUAGES_DOM.summary}>
                {count('ready')} ready · {count('needs-toolchain')} need a toolchain · {count('partial')} partial
            </span>
            <span className='ingot-flex' />
            <button type='button' className='theia-button secondary' id={LANGUAGES_DOM.refresh} disabled={busy} onClick={() => void refresh()}>
                {busy ? 'Checking…' : 'Re-check Toolchains'}
            </button>
        </div>
        <table className='ingot-languages-table' id={LANGUAGES_DOM.table}>
            <thead>
                <tr>
                    <th className='ingot-lang-name'>Language</th>
                    {reports[0]?.features.map(f => <th key={f.feature} className='ingot-lang-feature-head' title={FEATURE_LABELS[f.feature]}>{FEATURE_LABELS[f.feature]}</th>)}
                </tr>
            </thead>
            <tbody>
                {reports.map(report => <React.Fragment key={report.id}>
                    <tr className={`ingot-lang-row${open === report.id ? ' open' : ''}`} data-language={report.id} data-level={report.level}
                        tabIndex={0} aria-expanded={open === report.id}
                        onClick={() => setOpen(open === report.id ? undefined : report.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === report.id ? undefined : report.id); } }}>
                        <td className='ingot-lang-name'>
                            <span className={`codicon codicon-${open === report.id ? 'chevron-down' : 'chevron-right'}`} />
                            <span className='ingot-lang-label'>{report.label}</span>
                            <span className={`ingot-lang-level ingot-lang-level-${report.level}`}>{LANGUAGE_TEXT.levels[report.level]}</span>
                        </td>
                        {report.features.map(f => <FeatureCell key={f.feature} report={f} />)}
                    </tr>
                    {open === report.id && <tr className='ingot-lang-details' data-language={report.id}>
                        <td colSpan={report.features.length + 1}>
                            <LanguageDetails report={report} store={store} platform={platform} copy={copy} openUrl={openUrl} />
                        </td>
                    </tr>}
                </React.Fragment>)}
            </tbody>
        </table>
        <h3 className='ingot-settings-card-title'>Toolchains</h3>
        <div className='ingot-toolchains' id={LANGUAGES_DOM.toolchains}>
            {TOOLCHAIN_IDS.map(id =>
                <ToolchainRow key={id} id={id} status={store.toolchain(id)} platform={platform} copy={copy} openUrl={openUrl} />)}
        </div>
        <p className='ingot-dim ingot-languages-legend'>
            {(Object.keys(LANGUAGE_TEXT.states) as FeatureState[]).map(state => <span key={state} className={`ingot-lang-${state}`}>
                <span className={`codicon codicon-${FEATURE_STATE_ICONS[state]}`} /> {LANGUAGE_TEXT.states[state]}
            </span>)}
        </p>
    </section>;
};

const LanguageDetails = ({ report, store, platform, copy, openUrl }: { readonly report: LanguageReport; readonly platform: GuidePlatform } & LanguagesManagerProps): React.ReactElement =>
    <div className='ingot-lang-detail-body'>
        <div className='ingot-lang-extensions'>
            {report.extensions.map(e => <div key={e.id} className='ingot-lang-extension' data-extension={e.id} data-installed={e.installed}>
                <span className={`codicon codicon-${e.installed ? 'extensions' : e.onDemand ? 'cloud-download' : 'warning'}`} />
                <a href='#' onClick={ev => { ev.preventDefault(); ev.stopPropagation(); openUrl(e.url); }}>{e.label}</a>
                <code className='ingot-dim'>{e.id}</code>
                <span className='ingot-lang-licence'>{e.licence}</span>
                {e.onDemand && !e.installed && <span className='ingot-dim'>{LANGUAGE_TEXT.states['on-demand']}</span>}
            </div>)}
        </div>
        {report.features.filter(f => f.note || f.missing.length).map(f => <div key={f.feature} className='ingot-dim ingot-lang-note'>
            <b>{FEATURE_LABELS[f.feature]}:</b> {f.note ?? ''}{f.missing.length ? ` Needs ${f.missing.map(id => TOOLCHAINS[id].label).join(', ')}.` : ''}
        </div>)}
        {report.missingToolchains.map(id => <ToolchainRow key={id} id={id} status={store.toolchain(id)} platform={platform} copy={copy} openUrl={openUrl} />)}
    </div>;

const ToolchainRow = ({ id, status, platform, copy, openUrl }: {
    readonly id: ToolchainId; readonly status?: ToolchainStatus; readonly platform: GuidePlatform; readonly copy: (text: string) => void; readonly openUrl: (url: string) => void;
}): React.ReactElement => {
    const spec = TOOLCHAINS[id];
    const usable = !!status?.found && !status.tooOld;
    const command = installCommand(id, platform);
    return <div className={`ingot-toolchain${usable ? ' found' : ' missing'}`} data-toolchain={id} data-found={usable} title={`${spec.why}${status?.path ? `\n${status.path}` : ''}`}>
        <span className={`codicon codicon-${usable ? 'pass-filled' : 'warning'}`} />
        <span className='ingot-toolchain-label'>{spec.label}</span>
        <span className='ingot-toolchain-status'>{toolchainLabel(status)}</span>
        {!usable && <>
            <code className='ingot-toolchain-command'>{command}</code>
            <button type='button' className='ingot-btn-ghost ingot-toolchain-copy' title={LANGUAGE_TEXT.copy}
                onClick={e => { e.stopPropagation(); copy(command); }}><span className='codicon codicon-copy' /></button>
            <button type='button' className='ingot-btn-ghost ingot-toolchain-download' title={LANGUAGE_TEXT.download}
                onClick={e => { e.stopPropagation(); openUrl(spec.url); }}><span className='codicon codicon-link-external' /></button>
        </>}
    </div>;
};
