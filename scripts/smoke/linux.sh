#!/usr/bin/env bash
# Installer smoke test for Linux (IDEA-166). Runs as root in a clean ubuntu:24.04 container.
# Usage: scripts/smoke/linux.sh <installer-dir> <out-dir>
set -uo pipefail
IN="$(cd "$1" && pwd)"; OUT="$2"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
WAIT="${SMOKE_WAIT_SECONDS:-60}"
export DEBIAN_FRONTEND=noninteractive
FAILED=0
fail() { echo "::error::$*"; FAILED=1; }

DEB="$(ls "$IN"/*.deb | head -1)"; APPIMAGE="$(ls "$IN"/*.AppImage | head -1)"
[ -f "$DEB" ] || { echo "::error::no .deb in $IN"; exit 1; }
[ -f "$APPIMAGE" ] || { echo "::error::no .AppImage in $IN"; exit 1; }
ls -la "$IN"

# 1) Install the .deb on the clean image FIRST, so only its declared Depends are present when we check the libraries.
apt-get update -qq
apt-get install -y -qq "$DEB" > "$OUT/apt-install.log" 2>&1 || fail "apt install of the .deb failed (see apt-install.log)"
dpkg -s ingot | grep -E '^(Status|Version|Depends)' | tee "$OUT/deb-status.txt"

echo "== Shared libraries =="
{
  ldd /opt/Ingot/ingot
  find /opt/Ingot/resources/app/lib -name '*.node' -print0 | xargs -0 -n1 ldd
} > "$OUT/ldd.txt" 2>&1
if grep -q 'not found' "$OUT/ldd.txt"; then
  fail "the .deb installs but these libraries are missing (add them to deb Depends): $(grep 'not found' "$OUT/ldd.txt" | awk '{print $1}' | sort -u | tr '\n' ' ')"
fi

echo "== Desktop entry, icon, native modules =="
test -f /usr/share/applications/ingot.desktop || fail "missing /usr/share/applications/ingot.desktop"
cp /usr/share/applications/ingot.desktop "$OUT/" 2>/dev/null || true
for size in 16 24 32 48 64 128 256 512; do
  test -f "/usr/share/icons/hicolor/${size}x${size}/apps/ingot.png" || fail "missing hicolor icon ${size}x${size}/apps/ingot.png"
done
for f in drivelist.node keytar.node watcher.node keymapping.node rg; do
  test -e "/opt/Ingot/resources/app/lib/backend/native/$f" || fail "missing native module $f"
done
ls /opt/Ingot/resources/app/lib/prebuilds/linux-x64/pty.node >/dev/null 2>&1 || fail "missing node-pty prebuild"
[ -u /opt/Ingot/chrome-sandbox ] || echo "::warning::chrome-sandbox is not setuid"

# 2) Tools for the run (installed after the dependency check on purpose).
apt-get install -y -qq xvfb imagemagick iproute2 procps x11-utils > "$OUT/apt-tools.log" 2>&1 || fail "could not install test tools"
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp > "$OUT/xvfb.log" 2>&1 &
export DISPLAY=:99
sleep 2

FATAL='Cannot find module|was compiled against a different Node.js version|ERR_DLOPEN_FAILED|error while loading shared libraries|Segmentation fault|FATAL:|Uncaught Exception|unhandledRejection.*backend|Backend process exited|Failed to start the backend'

# run_app <name> <cmd...>: launch, wait, check alive + backend listening + log clean, screenshot, stop.
run_app() {
  local name="$1"; shift
  local home="/tmp/home-$name"; mkdir -p "$home"
  echo "== Launch $name =="
  HOME="$home" "$@" --no-sandbox --disable-dev-shm-usage > "$OUT/$name.log" 2>&1 &
  local pid=$!
  sleep "$WAIT"
  if kill -0 "$pid" 2>/dev/null; then echo "$name: still running after ${WAIT}s"; else fail "$name exited within ${WAIT}s"; fi
  ps -eo pid,ppid,etimes,rss,args | grep -iE 'ingot|appimage' | grep -v grep | cut -c1-220 | tee "$OUT/$name-processes.txt"
  ss -ltnp > "$OUT/$name-ports.txt" 2>&1
  if grep -q '"ingot"' "$OUT/$name-ports.txt"; then echo "$name: backend is listening: $(grep '"ingot"' "$OUT/$name-ports.txt" | awk '{print $4}' | tr '\n' ' ')"
  else fail "$name: no listening backend port owned by the app"; fi
  xwininfo -root -tree 2>/dev/null | grep -i ingot | head -5 | tee "$OUT/$name-windows.txt"
  [ -s "$OUT/$name-windows.txt" ] || fail "$name: no Ingot window on the display"
  import -window root "$OUT/$name.png" || echo "::warning::screenshot failed"
  if grep -E "$FATAL" "$OUT/$name.log" > "$OUT/$name-fatal.txt"; then fail "$name: fatal lines in the log: $(head -3 "$OUT/$name-fatal.txt")"; fi
  find "$home" -name '*.log' -size -5M -exec cp --parents {} "$OUT/" \; 2>/dev/null || true
  kill "$pid" 2>/dev/null; sleep 3; pkill -f /opt/Ingot/ingot 2>/dev/null; pkill -f appimage_extracted 2>/dev/null; sleep 2
}

run_app ubuntu-deb /opt/Ingot/ingot

chmod +x "$APPIMAGE"
# FUSE is not available in containers; extract-and-run is what a user without libfuse2 gets too.
export APPIMAGE_EXTRACT_AND_RUN=1
run_app ubuntu-appimage "$APPIMAGE"

echo "== Uninstall =="
apt-get remove -y -qq ingot > "$OUT/apt-remove.log" 2>&1 || fail "apt remove failed"
test ! -e /opt/Ingot/ingot || fail "/opt/Ingot/ingot still present after remove"

if [ "$FAILED" = 1 ]; then echo "Smoke test FAILED"; exit 1; fi
echo "Smoke test passed"
