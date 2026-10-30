# Releasing the Ingot desktop app

The release pipeline (`.github/workflows/release.yml`, IDEA-134 / IDEA-269) builds every installer when a version tag
is pushed and **publishes** a GitHub Release on `yaghobieh/ingot` with the installers and the `latest*.yml` update
feeds. Installed apps find it through auto-update within 4 hours (or right away with **Help › Check for Updates…**).

```text
git tag v0.2.0 && git push origin v0.2.0
        │
        ▼
Release workflow ── build (4 runners in parallel) ───────────────────────────────┐
  macOS arm64 / x64   electron-builder --mac   → .dmg + .zip + latest-mac.yml     │
  Windows x64         electron-builder --win   → NSIS .exe + latest.yml           │
  Linux x64           electron-builder --linux → .AppImage + .deb + latest-linux.yml
        │                                                                         │
        ▼                                                                         │
  release job: merge the two latest-mac.yml, check every feed exists, publish ◄──┘
        │
        ▼
GitHub Release v0.2.0 (pre-release when the tag has a "-")
        │
        ▼
Installed apps: electron-updater reads latest*.yml → downloads in the background → "Restart to Update"
```

Want to look at the assets before users get them? Set the repository variable `INGOT_RELEASE_DRAFT=true`
(Settings › Secrets and variables › Actions › Variables): the workflow then creates a **draft**, which the updater
ignores until a maintainer clicks **Publish release**.

| Platform | Runner | Output |
| --- | --- | --- |
| macOS Apple Silicon | `macos-latest` | `Ingot-<version>-mac-arm64.dmg` + `.zip` (the zip feeds auto-update) |
| macOS Intel | `macos-15-intel` | `Ingot-<version>-mac-x64.dmg` + `.zip` |
| Windows x64 | `windows-latest` | `Ingot-<version>-win-x64.exe` (NSIS installer) |
| Linux x64 | `ubuntu-24.04` (pinned) | `Ingot-<version>-linux-x86_64.AppImage`, `Ingot-<version>-linux-amd64.deb` |

Each job also uploads its update feed (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`) and `.blockmap` files; the
release job merges the two macOS feeds into one `latest-mac.yml`.

## Cut a release

```bash
git checkout release/0.1.0 && git pull
git tag v0.1.0-beta.1          # a "-" in the tag marks the GitHub Release as a pre-release
git push origin v0.1.0-beta.1
```

When the **Release** workflow is green the release is live (or waiting as a draft with `INGOT_RELEASE_DRAFT=true`).
The website's Download page picks up the newest published release (pre-releases included) within 10 minutes.

Tags without a "-" (`v0.2.0`) are stable releases and reach both channels; tags with one (`v0.2.0-beta.1`) are
pre-releases and reach only apps on the **beta** channel.

The tag sets the app version (`-c.extraMetadata.version`), so `package.json` does not need a bump for betas.
A manual run (Actions › Release › Run workflow) builds the installers as workflow artifacts without creating a release.

## Local build (unsigned)

```bash
npm ci
npm run build:electron
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:electron -- --mac --arm64 -c.mac.identity=-   # ad-hoc signed
# Windows: npm run package:electron -- --win --x64    Linux: npm run package:electron -- --linux --x64
ls applications/electron/dist
```

Native modules are compiled for the machine that runs `build:electron`, so build each architecture on its own OS/arch.

## Installer smoke test (Windows + Linux)

`.github/workflows/smoke-installers.yml` installs the app the way a user would and checks that it really starts:

- **Windows** (`windows-latest`): silent NSIS install (`/S`), Start menu + uninstall entries, launch, the app is still up after 60 s, its backend is listening, no fatal lines in the logs, a screenshot, then a silent uninstall. Script: `scripts/smoke/windows.ps1`.
- **Ubuntu 24.04** (clean `ubuntu:24.04` container): `apt install ./Ingot-*.deb`, then every shared library of the app and its native modules must resolve (catches a missing `Depends`), desktop entry + icon, launch the `.deb` build and the AppImage under Xvfb with the same checks. Script: `scripts/smoke/linux.sh`.

It runs on pull requests that touch packaging (building the installers from the branch), on every published release, and by hand: **Actions -> Installer smoke test -> Run workflow** with a tag such as `v0.1.0-beta.1`. Screenshots and logs are in the run's `smoke-windows` / `smoke-linux` artifacts.

## Server and website URLs (repository variables)

Release builds bake the public URLs into the app, so testers sign in against production without any setup.
Set them under GitHub › Settings › Secrets and variables › Actions › **Variables** (they are not secret):

| Variable | Example | Used for |
| --- | --- | --- |
| `INGOT_SERVER_URL` | `https://api.example.com` | account, usage and the model gateway |
| `INGOT_PORTAL_URL` | `https://example.com` | sign-in page and dashboard links |

When a variable is missing the build still succeeds, prints a warning and the app keeps the localhost defaults
(`http://127.0.0.1:3300` and `http://localhost:3200`), which is what dev runs use.

Which URL the app uses, first match wins:

1. `ingot.account.serverUrl` / `ingot.account.portalUrl` in `~/.ingot/ingot.settings.json` (or Settings › Ingot account)
2. `INGOT_SERVER_URL` / `INGOT_PORTAL_URL` in the environment when the app starts
3. the URLs baked into the release build (`ingotEndpoints` in the packaged `package.json`)
4. the localhost defaults

For a local packaged build, pass them the same way the workflow does:
`npm run package:electron -- --mac --arm64 -c.extraMetadata.ingotEndpoints.serverUrl=https://api.example.com`.

## Apple Developer account (required for macOS auto-update)

Signing and notarizing the macOS app needs a paid **Apple Developer Program** membership (organization or individual,
99 USD/year, enrolled at developer.apple.com). Without it the pipeline still works, but:

- macOS users get an ad-hoc signed app that Gatekeeper blocks on first launch (see "What unsigned means" below).
- **macOS auto-update does not work**: Squirrel.Mac, which electron-updater uses to swap the app, refuses an update
  whose code signature does not match a Developer ID. The app still checks, downloads and offers the restart, and the
  install fails with a signature error in the log. Unsigned testers download each new version by hand.

With the account, a maintainer with the Account Holder or Admin role creates once:

1. A **Developer ID Application** certificate (Certificates, Identifiers & Profiles › Certificates › +). Install it in
   Keychain, export it with its private key as `.p12`, and `base64 -i cert.p12 | pbcopy` into the `CSC_LINK` secret.
2. An **app-specific password** for the Apple ID that notarizes (appleid.apple.com › Sign-In and Security).
3. The 10-character **Team ID** (developer.apple.com › Membership details).

Windows and Linux auto-update need no account: NSIS and AppImage updates install unsigned (Windows shows SmartScreen
until the app is signed with a code-signing certificate).

## Signing and notarization (optional, secret-gated)

Without these secrets the pipeline still succeeds and produces **unsigned** installers. Add them under
GitHub › Settings › Secrets and variables › Actions; each step switches on by itself once its secrets exist.

| Secret | Used for |
| --- | --- |
| `CSC_LINK` | Developer ID Application certificate, `.p12` exported from Keychain, base64-encoded (older name: `MAC_CSC_LINK`) |
| `CSC_KEY_PASSWORD` | password of that `.p12` (older name: `MAC_CSC_KEY_PASSWORD`) |
| `APPLE_ID` | Apple ID email of the Apple Developer account (notarization) |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com (notarization) |
| `APPLE_TEAM_ID` | 10-character Team ID (notarization) |
| `WIN_CSC_LINK` | Windows code-signing certificate (`.pfx`, base64) |
| `WIN_CSC_KEY_PASSWORD` | password of that `.pfx` |

Notarization runs only when the macOS certificate **and** all three Apple secrets are set. `GITHUB_TOKEN` (automatic)
creates the release; no personal token is needed.

Windows certificates on hardware tokens / cloud HSMs (Azure Trusted Signing, DigiCert KeyLocker) need a custom
`win.sign` hook instead of `WIN_CSC_LINK`; add it when that account exists.

### What unsigned means for testers

- **macOS:** the app is ad-hoc signed only, so Gatekeeper blocks the first launch. Open the app once, then System Settings › Privacy & Security ›
  **Open Anyway** (or `xattr -dr com.apple.quarantine /Applications/Ingot.app`). Auto-update cannot replace an
  unsigned macOS app; testers download new betas manually until the app is signed.
- **Windows:** SmartScreen shows "Windows protected your PC" › **More info** › **Run anyway**.
- **Linux:** no signing needed. `chmod +x` the AppImage, or `sudo apt install ./Ingot-*.deb`.

## Auto-update

Packaged builds check GitHub Releases with `electron-updater` 15 s after launch and then every 4 hours, download in
the background, and show **"Ingot X is ready. Restart to update."** with a **Restart to Update** button. "Later" keeps
the update: it installs on the next quit. The feed (owner/repo) comes from the `publish` block in
`applications/electron/electron-builder.yml`, baked into the app as `app-update.yml`.

| Piece | Where |
| --- | --- |
| Schedule, download, install (main process) | `packages/ingot-core/src/electron-main/update/ingot-update-controller.ts` |
| electron-updater wiring | `packages/ingot-core/src/electron-main/update/electron-update-driver.ts` |
| Command, notification, channel sync (window) | `packages/ingot-core/src/electron-browser/update/ingot-updater-contribution.ts` |
| Force-update screen (minVersion) | `packages/ingot-core/src/browser/config/update-contribution.ts` |

- **Help › Check for Updates…** (`ingot.update.check`, also in Find Action) checks now and says what happened:
  up to date, downloading, ready to restart, the error, or why updates are off.
- **`ingot.update.channel`** (Settings, `stable` | `beta`): stable follows releases only, beta also pre-releases.
  Until it is set, pre-release builds (`0.1.0-beta.1`) follow beta and release builds follow stable.
- Off in dev runs (`npm run start:electron`), for `.deb` installs (apt updates those), and when
  `INGOT_DISABLE_AUTO_UPDATE=1`.
- Drafts are invisible to the updater: publishing the release is what ships an update.

### Minimum version (forced update)

ingot-server's `GET /v1/config` can return `ide.minVersion` (and `ide.forceUpdate`). When the running build is older:

1. The window shows the "This version is no longer supported" screen (IDEA-125); the agent and chat stop working.
2. In the desktop app the screen asks the main process to update now, whatever the schedule. The main process compares
   `minVersion` with the real app version, downloads the newest release (pre-releases too when `minVersion` is one),
   and the screen shows the progress, then **Restart to Update**.
3. When the updater cannot run (dev build, `.deb`, unsigned macOS build, offline) the screen keeps the **Download**
   button that opens the release page.

The server is optional: without it, or offline, nothing is forced.

### Trying it locally

Dev runs never contact GitHub. To see the whole flow without a release, start the desktop app with a simulated
published version (ignored by packaged builds):

```bash
INGOT_UPDATE_SIMULATE=9.9.9 npm run start:electron
```

Help › Check for Updates… then "downloads" 9.9.9 and offers **Restart to Update**, which quits the app (nothing is
installed). `e2e/electron/auto-update.electron.spec.ts` drives exactly this.
