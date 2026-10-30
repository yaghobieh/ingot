import type { CodeSeverity, CodeToolName } from './code-tools.types';

/** IDEA-259: language-server tools in the agent's built-in tool list. */
export const CODE_TOOLS = [
    { name: 'go_to_definition', description: 'Find where a symbol is defined, using the language server. Arguments: {"path": "src/cart.ts", "symbol": "useCart", "line"?: 12} or {"path", "line", "column"}. Returns file:line:column and the line text. Runs at once.' },
    { name: 'find_references', description: 'Find every reference to a symbol across the project, using the language server. Arguments: {"path": "src/cart.ts", "symbol": "useCart", "line"?: 12} or {"path", "line", "column"}. Runs at once.' },
    { name: 'rename_symbol', description: 'Rename a symbol and every reference to it across files, using the language server (safer than text edits). Arguments: {"path": "src/cart.ts", "symbol": "useCart", "line"?: 12, "new_name": "useBasket"}. The edits show for Accept or Reject.' },
    { name: 'organize_imports', description: 'Sort imports and remove unused ones in a file, using the language server. Arguments: {"path": "src/cart.ts"}. The edit shows for Accept or Reject.' },
    { name: 'diagnostics', description: 'Errors and warnings from the language servers (the Problems list). Arguments: {"path"?: "src/cart.ts", "severity"?: "error" | "warning"}. With a path, the file is checked first. Runs at once.' }
] as const satisfies readonly { readonly name: CodeToolName; readonly description: string }[];

export const CODE_TOOL_NAMES: readonly CodeToolName[] = CODE_TOOLS.map(tool => tool.name);
/** Code tools that change files; they need a mode that can edit. */
export const CODE_EDIT_TOOLS: readonly CodeToolName[] = ['rename_symbol', 'organize_imports'];

export const CODE_TOOL_TITLES: Record<CodeToolName, string> = {
    go_to_definition: 'Went to definition',
    find_references: 'Found references',
    rename_symbol: 'Renamed symbol',
    organize_imports: 'Organized imports',
    diagnostics: 'Checked problems'
};

/** Checklist verbs for the run's steps. */
export const CODE_TOOL_STEPS: Record<CodeToolName, string> = {
    go_to_definition: 'Go to definition',
    find_references: 'Find references',
    rename_symbol: 'Rename',
    organize_imports: 'Organize imports',
    diagnostics: 'Check problems'
};

export const CODE_TOOL_ICONS: Record<CodeToolName, string> = {
    go_to_definition: 'go-to-file',
    find_references: 'references',
    rename_symbol: 'symbol-key',
    organize_imports: 'list-ordered',
    diagnostics: 'warning'
};

/** LSP severity numbers (1 = error … 4 = hint). */
export const LSP_SEVERITIES: Record<number, CodeSeverity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
export const SEVERITY_ORDER: readonly CodeSeverity[] = ['error', 'warning', 'info', 'hint'];

export const MAX_CODE_LOCATIONS = 100;
export const MAX_DIAGNOSTICS = 150;
export const PREVIEW_MAX_CHARS = 160;
/** Valid new name for rename_symbol: an identifier in the common languages. */
export const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

/** How long a tool waits for the file's language server to register (it starts on the first file of that language). */
export const PROVIDER_WAIT_MS = 20_000;
export const PROVIDER_POLL_MS = 250;
/** How long diagnostics for a just-opened file may take, and the quiet time after the last update. */
export const DIAGNOSTICS_WAIT_MS = 15_000;
export const DIAGNOSTICS_SETTLE_MS = 800;
/** Servers check a file at least this long after an edit (TypeScript: 300 ms), so sooner reports are stale. */
export const DIAGNOSTICS_DELAY_MS = 300;
/** The first report of a language: its server may still be starting and loading the project. */
export const LANGUAGE_WARMUP_MS = 60_000;
/** Monaco's `CodeActionTriggerType.Invoke` (a const enum, so not importable at runtime). */
export const CODE_ACTION_INVOKE = 1;

export const CODE_TOOLS_HINT = 'Prefer ingot/rename_symbol over hand edits to rename, ingot/find_references and ingot/go_to_definition over grep to follow code, and ingot/diagnostics to check a file after editing it.';
export const NO_PROVIDER = 'No language server for this file type answered. Use ingot/grep and ingot/read_file instead.';
