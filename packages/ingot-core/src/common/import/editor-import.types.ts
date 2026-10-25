/** Import from another editor (IDEA-107): extensions, settings and keybindings found in other local editors' folders. */
export const EditorImportService = Symbol('IngotEditorImportService');
export const EDITOR_IMPORT_SERVICE_PATH = '/services/ingot/editor-import';

export interface DetectedExtension {
    /** `publisher.name`, lower case. */
    readonly id: string;
    readonly version: string;
    readonly displayName?: string;
    /** Absolute folder of the installed extension. */
    readonly folder: string;
}

export interface ImportSource {
    /** The extensions folder that was read (shown by path only). */
    readonly path: string;
    readonly extensions: readonly DetectedExtension[];
    /** User settings.json next to it, when present. */
    readonly settingsFile?: string;
    readonly keybindingsFile?: string;
}

export type ExtensionImportVia = 'openvsx' | 'local';

export interface PreparedExtension {
    readonly id: string;
    /** Deployable entry for the plugin server: `local-file:/…/x.vsix` or `local-dir:/…`. */
    readonly entry: string;
    readonly via: ExtensionImportVia;
}

export interface SettingsImportResult {
    /** Keys added to the Ingot user settings (existing Ingot values are kept). */
    readonly added: number;
    readonly skipped: number;
}

export interface EditorImportService {
    detect(): Promise<ImportSource[]>;
    /** Downloads the extension from Open VSX, or stages the local copy when Open VSX does not have it. */
    prepare(extension: DetectedExtension): Promise<PreparedExtension>;
    importSettings(file: string): Promise<SettingsImportResult>;
    importKeybindings(file: string): Promise<SettingsImportResult>;
}
