# Import from another editor

Ingot can bring over extensions, settings and keybindings from other editors installed on the same machine.

- **Where:** the first time Ingot starts and finds extensions in another editor's folder it asks once; you can always run **Import from Another Editor…** from the command palette, the gear (Manage) menu or **File › Preferences**.
- **What it reads:** each editor's extensions folder in your home folder (`extensions.json`, or each extension's `package.json`) and, next to it, the user `settings.json` and `keybindings.json`. The dialog lists every folder by its path.
- **Extensions:** each one is installed from [Open VSX](https://open-vsx.org) with the same id. When Open VSX does not have it, Ingot copies the local folder instead (into its own `deployedPlugins` folder, so it survives restarts).
- **Settings and keybindings** are optional (unchecked by default). Imported settings never overwrite a value Ingot already has; keybindings are appended unless the same binding exists.
