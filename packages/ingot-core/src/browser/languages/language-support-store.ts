import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PreferenceSchemaService } from '@theia/core/lib/common/preferences';
import { JAVA_HOME_SETTINGS } from '../../common/languages/languages.consts';
import { ToolchainService, type LanguageReport, type ToolchainId, type ToolchainStatus } from '../../common/languages/languages.types';
import { languageReports, missingToolchainSettings } from '../../common/languages/languages.utils';

interface LanguageState {
    readonly installed: ReadonlySet<string>;
    readonly toolchains: ReadonlyMap<ToolchainId, ToolchainStatus>;
    readonly reports: readonly LanguageReport[];
}

/** IDEA-313: what each language can do here (installed extensions + toolchains on this machine), for the page, prompts and Run. */
@injectable()
export class LanguageSupportStore {

    @inject(ToolchainService) readonly service: ToolchainService;
    @inject(PreferenceSchemaService) protected readonly schema: PreferenceSchemaService;

    protected readonly changed = new Emitter<void>();
    readonly onDidChange = this.changed.event;
    protected state?: LanguageState;
    protected loading?: Promise<LanguageState>;
    protected readonly javaHomeDefaults = new DisposableCollection();
    protected readonly missingToolchainDefaults = new DisposableCollection();

    get loaded(): boolean {
        return !!this.state;
    }

    get reports(): readonly LanguageReport[] {
        return this.state?.reports ?? [];
    }

    get toolchains(): ReadonlyMap<ToolchainId, ToolchainStatus> {
        return this.state?.toolchains ?? new Map();
    }

    toolchain(id: ToolchainId): ToolchainStatus | undefined {
        return this.state?.toolchains.get(id);
    }

    /** Loads once; later calls share the result. */
    load(): Promise<LanguageState> {
        this.loading ??= this.fetch();
        return this.loading;
    }

    /** Checks again (after the user installed a toolchain). */
    async refresh(): Promise<void> {
        await this.service.refresh();
        this.loading = undefined;
        await this.load();
    }

    protected async fetch(): Promise<LanguageState> {
        const [installed, statuses] = await Promise.all([this.service.installedExtensions(), this.service.check()]);
        const installedSet = new Set(installed);
        const state: LanguageState = {
            installed: installedSet,
            toolchains: new Map(statuses.map(s => [s.id, s] as const)),
            reports: languageReports(installedSet, statuses)
        };
        this.state = state;
        this.applyJavaHome(state.toolchains.get('jre'));
        this.applyMissingToolchains(statuses);
        this.changed.fire();
        return state;
    }

    /** No Java on this machine: the COBOL and Kotlin servers default to the Java bundled with Java support. */
    protected applyJavaHome(jre: ToolchainStatus | undefined): void {
        this.javaHomeDefaults.dispose();
        if (jre?.bundled && jre.path) {
            for (const key of JAVA_HOME_SETTINGS) {
                this.javaHomeDefaults.push(this.schema.registerOverride(key, undefined, jre.path));
            }
        }
    }

    /** Missing toolchains: turn off the extension parts that would only show errors (Ingot's prompt says what to install). */
    protected applyMissingToolchains(statuses: readonly ToolchainStatus[]): void {
        this.missingToolchainDefaults.dispose();
        for (const [key, value] of missingToolchainSettings(statuses)) {
            this.missingToolchainDefaults.push(this.schema.registerOverride(key, undefined, value));
        }
    }
}
