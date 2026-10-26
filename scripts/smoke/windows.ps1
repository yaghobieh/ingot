# Installer smoke test for Windows (IDEA-166): silent NSIS install, launch, check, screenshot, silent uninstall.
# Usage: ./scripts/smoke/windows.ps1 -InstallerDir installers -OutDir smoke-out
param(
  [Parameter(Mandatory = $true)][string]$InstallerDir,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$WaitSeconds = 60
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$script:Failed = $false
function Fail([string]$msg) { Write-Host "::error::$msg"; $script:Failed = $true }

$installer = Get-ChildItem $InstallerDir -Filter *.exe | Select-Object -First 1
if (-not $installer) { Write-Host "::error::no .exe in $InstallerDir"; exit 1 }
Write-Host "Installer: $($installer.Name) ($([math]::Round($installer.Length / 1MB)) MB)"

# 1) Silent per-user install (NSIS /S). Default location: %LOCALAPPDATA%\Programs\Ingot
$t = Measure-Command { $p = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru }
Write-Host "Install exit code $($p.ExitCode) in $([int]$t.TotalSeconds)s"
if ($p.ExitCode -ne 0) { Fail "installer exited with $($p.ExitCode)" }

$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Ingot'
$app = Join-Path $appDir 'Ingot.exe'
if (-not (Test-Path $app)) {
  $found = Get-ChildItem -Path $env:LOCALAPPDATA, $env:ProgramFiles -Filter Ingot.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $app = $found.FullName; $appDir = $found.DirectoryName } else { Fail 'Ingot.exe not found after install'; exit 1 }
}
Write-Host "Installed at $appDir"

$native = Join-Path $appDir 'resources\app\lib\backend\native'
foreach ($f in 'drivelist.node', 'keytar.node', 'watcher.node', 'keymapping.node', 'rg.exe') {
  if (-not (Test-Path (Join-Path $native $f))) { Fail "missing native module $f" }
}
if (-not (Get-ChildItem (Join-Path $appDir 'resources\app\lib') -Recurse -Filter pty.node -ErrorAction SilentlyContinue)) { Fail 'missing node-pty (pty.node)' }

$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ingot.lnk'
$startLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Ingot.lnk'
if (-not (Test-Path $desktopLnk)) { Write-Host "::warning::no desktop shortcut at $desktopLnk" }
if (-not (Test-Path $startLnk)) { Fail "no Start menu shortcut at $startLnk" }
$uninstallKey = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -like 'Ingot*' } | Select-Object -First 1
if ($uninstallKey) { Write-Host "Apps & features entry: $($uninstallKey.DisplayName) $($uninstallKey.DisplayVersion)" } else { Fail 'no Apps & features (uninstall) entry' }

# 2) Launch and wait.
$proc = Start-Process -FilePath $app -PassThru -RedirectStandardOutput (Join-Path $OutDir 'windows-stdout.log') -RedirectStandardError (Join-Path $OutDir 'windows-stderr.log')
Start-Sleep -Seconds $WaitSeconds
if ($proc.HasExited) { Fail "Ingot exited within $WaitSeconds s (exit code $($proc.ExitCode))" } else { Write-Host "Ingot still running after $WaitSeconds s" }

$procs = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($appDir, [StringComparison]::OrdinalIgnoreCase) }
$procs | Select-Object ProcessId, ParentProcessId, @{ n = 'CommandLine'; e = { if ($_.CommandLine.Length -gt 200) { $_.CommandLine.Substring(0, 200) } else { $_.CommandLine } } } | Format-Table -AutoSize | Out-String -Width 300 | Tee-Object (Join-Path $OutDir 'windows-processes.txt')
$ids = @($procs.ProcessId)
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess }
if ($listen) { Write-Host "Backend listening on: $(($listen | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', ')" } else { Fail 'no listening backend port owned by the app' }

$win = Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if ($win) { Write-Host "Window: '$($win[0].MainWindowTitle)'" } else { Fail 'no visible Ingot window' }

# 3) Screenshot of the whole desktop.
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $OutDir 'windows.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
} catch { Write-Host "::warning::screenshot failed: $_" }

# 4) Logs: fatal patterns in stdout/stderr and the app's own log files.
foreach ($d in (Join-Path $env:APPDATA 'Ingot'), (Join-Path $env:USERPROFILE '.ingot'), (Join-Path $env:USERPROFILE '.theia')) {
  if (Test-Path $d) { Get-ChildItem $d -Recurse -Filter *.log -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 5MB } | ForEach-Object { Copy-Item $_.FullName (Join-Path $OutDir ("app-" + $_.Name)) -ErrorAction SilentlyContinue } }
}
$fatal = 'Cannot find module|was compiled against a different Node.js version|ERR_DLOPEN_FAILED|is not a valid Win32 application|The specified module could not be found|FATAL:|Uncaught Exception|Backend process exited|Failed to start the backend'
$hits = Get-ChildItem $OutDir -Filter *.log | Select-String -Pattern $fatal
if ($hits) { $hits | Out-File (Join-Path $OutDir 'windows-fatal.txt'); Fail "fatal lines in the log: $(($hits | Select-Object -First 3 | ForEach-Object { $_.Line }) -join ' | ')" }

# 5) Stop and uninstall silently.
$ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
$uninst = Join-Path $appDir 'Uninstall Ingot.exe'
if (Test-Path $uninst) {
  Start-Process -FilePath $uninst -ArgumentList '/S' -Wait
  # The NSIS uninstaller re-launches itself from %TEMP%, so poll until the files are gone.
  for ($i = 0; $i -lt 60 -and (Test-Path $app); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path $app) { Fail 'Ingot.exe still present after silent uninstall' } else { Write-Host 'Uninstalled cleanly' }
} else { Fail "no uninstaller at $uninst" }

if ($script:Failed) { Write-Host 'Smoke test FAILED'; exit 1 }
Write-Host 'Smoke test passed'
