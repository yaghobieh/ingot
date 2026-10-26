# Releasing the Ingot desktop app

The release pipeline (`.github/workflows/release.yml`, IDEA-134) builds every installer when a version tag is pushed
and attaches them to a **draft** GitHub Release. Nothing is public until a maintainer publishes the draft.

| Platform | Runner | Output |
| --- | --- | --- |
| macOS Apple Silicon | `macos-latest` | `Ingot-<version>-mac-arm64.dmg` + `.zip` (the zip feeds auto-update) |
| macOS Intel | `macos-15-intel` | `Ingot-<version>-mac-x64.dmg` + `.zip` |
| Windows x64 | `windows-latest` | `Ingot-<version>-win-x64.exe` (NSIS installer) |
| Linux x64 | `ubuntu-latest` | `Ingot-<version>-linux-x86_64.AppImage`, `Ingot-<version>-linux-amd64.deb` |

Each job also uploads its update feed (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`) and `.blockmap` files; the
release job merges the two macOS feeds into one `latest-mac.yml`.

## Cut a release

```bash
git checkout release/0.1.0 && git pull
git tag v0.1.0-beta.1          # a "-" in the tag marks the GitHub Release as a pre-release
git push origin v0.1.0-beta.1
```

Then, when the **Release** workflow is green: GitHub › Releases › the new draft › check the assets › **Publish release**.
The website's Download page picks up the newest published release (pre-releases included) within 10 minutes.

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

## Signing and notarization (optional, secret-gated)

Without these secrets the pipeline still succeeds and produces **unsigned** installers. Add them under
GitHub › Settings › Secrets and variables › Actions; each step switches on by itself once its secrets exist.

| Secret | Used for |
| --- | --- |
| `MAC_CSC_LINK` | Developer ID Application certificate, `.p12` exported from Keychain, base64-encoded |
| `MAC_CSC_KEY_PASSWORD` | password of that `.p12` |
| `APPLE_ID` | Apple ID email of the Apple Developer account (notarization) |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com (notarization) |
| `APPLE_TEAM_ID` | 10-character Team ID (notarization) |
| `WIN_CSC_LINK` | Windows code-signing certificate (`.pfx`, base64) |
| `WIN_CSC_KEY_PASSWORD` | password of that `.pfx` |

Notarization runs only when the macOS certificate **and** all three Apple secrets are set. `GITHUB_TOKEN` (automatic)
creates the draft release; no personal token is needed.

Windows certificates on hardware tokens / cloud HSMs (Azure Trusted Signing, DigiCert KeyLocker) need a custom
`win.sign` hook instead of `WIN_CSC_LINK`; add it when that account exists.

### What unsigned means for testers

- **macOS:** the app is ad-hoc signed only, so Gatekeeper blocks the first launch. Open the app once, then System Settings › Privacy & Security ›
  **Open Anyway** (or `xattr -dr com.apple.quarantine /Applications/Ingot.app`). Auto-update cannot replace an
  unsigned macOS app; testers download new betas manually until the app is signed.
- **Windows:** SmartScreen shows "Windows protected your PC" › **More info** › **Run anyway**.
- **Linux:** no signing needed. `chmod +x` the AppImage, or `sudo apt install ./Ingot-*.deb`.

## Auto-update

Packaged builds check GitHub Releases with `electron-updater` 15 s after launch and every 6 hours, download in the
background and install on quit (`IngotAutoUpdateContribution`). The feed comes from the `publish` block in
`applications/electron/electron-builder.yml`.

- Pre-release builds (`0.1.0-beta.1`) also follow newer pre-releases; stable builds follow stable releases only.
- Off in dev runs, for `.deb` installs (apt updates those), and when `INGOT_DISABLE_AUTO_UPDATE=1`.
- Drafts are invisible to the updater, so publishing the draft is what ships an update.
