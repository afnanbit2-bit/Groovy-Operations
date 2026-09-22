#!/usr/bin/env bash
# ── One-shot Raspberry Pi installer for the Groovy attendance puller ────────
# Installs Node.js, the puller's deps, and registers pull.js as a systemd
# service that starts on boot and auto-restarts if it ever crashes.
#
#   Run once on a fresh Raspberry Pi OS:
#     cd Groovy-Operations/attendance-sync && bash setup-pi.sh
#
#   The clock's address defaults to 192.168.100.201:4370. Override it:
#     ZK_IP=192.168.1.50 ZK_PORT=4370 bash setup-pi.sh
#
# After this the clock syncs 24/7 with no PC. Useful commands:
#   sudo systemctl status  groovy-attendance     # is it running?
#   journalctl -u groovy-attendance -f           # live log of punches
#   sudo systemctl restart groovy-attendance     # restart it
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(whoami)"
ZK_IP="${ZK_IP:-192.168.100.201}"
ZK_PORT="${ZK_PORT:-4370}"
NEED_NODE_MAJOR=16

echo "→ Clock address: $ZK_IP:$ZK_PORT"

# ── Timezone ────────────────────────────────────────────────────────────────
# The punch timestamps themselves are the device's own wall clock and survive
# any timezone (node-zklib builds them with the local Date constructor and the
# puller formats them back with the local getters, so the two cancel out).
# This is for readable logs and a correct first-run 24h window.
if command -v timedatectl >/dev/null 2>&1; then
  CURRENT_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || echo '')"
  if [ "$CURRENT_TZ" != "Asia/Karachi" ]; then
    echo "→ Setting timezone to Asia/Karachi (was ${CURRENT_TZ:-unknown})…"
    sudo timedatectl set-timezone Asia/Karachi || echo "  (could not set timezone — carrying on)"
  else
    echo "→ Timezone already Asia/Karachi."
  fi
fi

# ── Node.js ─────────────────────────────────────────────────────────────────
# Raspberry Pi OS ships whatever Node its Debian base pinned; on older images
# that is too old for node-zklib. Check the version we actually end up with
# rather than assuming apt gave us a usable one.
# Must ALWAYS echo an integer: with `set -e`, an empty result makes
# `[ "" -lt 16 ]` a syntax error that reads as false, which would silently
# skip installing Node on a Pi that has none.
node_major() {
  local v
  v="$(node -v 2>/dev/null || true)"
  v="${v#v}"; v="${v%%.*}"
  case "$v" in ''|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}

if [ "$(node_major)" -lt "$NEED_NODE_MAJOR" ]; then
  echo "→ Installing Node.js from apt…"
  sudo apt-get update -y
  sudo apt-get install -y nodejs npm
fi

if [ "$(node_major)" -lt "$NEED_NODE_MAJOR" ]; then
  echo "→ apt's Node.js is $(node -v 2>/dev/null || echo 'missing') — too old. Installing Node 20 from NodeSource…"
  sudo apt-get install -y curl ca-certificates
  # NodeSource's nodejs bundles npm and conflicts with Debian's separate one.
  sudo apt-get remove -y npm >/dev/null 2>&1 || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if [ "$(node_major)" -lt "$NEED_NODE_MAJOR" ]; then
  echo "✗ Node.js is still $(node -v 2>/dev/null || echo 'missing'); need v${NEED_NODE_MAJOR}+."
  echo "  Install a newer Node by hand, then re-run this script."
  exit 1
fi
echo "→ Node.js $(node -v) OK."

# ── Dependencies ────────────────────────────────────────────────────────────
echo "→ Installing puller dependencies…"
( cd "$DIR" && npm install --omit=dev --no-audit --no-fund )

NODE_BIN="$(command -v node)"

# ── Reachability check ──────────────────────────────────────────────────────
# Better to fail here, with the installer's output on screen, than to leave a
# service quietly retrying a clock nobody told it about.
echo "→ Checking the clock answers on $ZK_IP:$ZK_PORT…"
if command -v nc >/dev/null 2>&1 && nc -z -w 5 "$ZK_IP" "$ZK_PORT" 2>/dev/null; then
  echo "  reachable."
else
  echo "  ⚠ NO ANSWER from $ZK_IP:$ZK_PORT."
  echo "    The service will still be installed and will keep retrying, but check:"
  echo "      • the clock is powered on and on this same network"
  echo "      • its IP really is $ZK_IP  (K40: Menu → Comm. → Ethernet)"
  echo "      • re-run with the right one:  ZK_IP=x.x.x.x bash setup-pi.sh"
fi

# ── Service ─────────────────────────────────────────────────────────────────
echo "→ Registering the auto-start service…"
sudo tee /etc/systemd/system/groovy-attendance.service >/dev/null <<EOF
[Unit]
Description=Groovy K40 Attendance Puller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
Environment=ZK_IP=$ZK_IP
Environment=ZK_PORT=$ZK_PORT
ExecStart=$NODE_BIN pull.js
Restart=always
RestartSec=10
User=$USER_NAME

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable groovy-attendance
sudo systemctl restart groovy-attendance

sleep 3
echo ""
if systemctl is-active --quiet groovy-attendance; then
  echo "✓ Done. The puller is running and will start on every boot."
else
  echo "✗ The service is installed but not running. See why:"
  echo "    journalctl -u groovy-attendance -n 40 --no-pager"
  exit 1
fi
echo ""
echo "  Watch it live:   journalctl -u groovy-attendance -f"
echo "  Check the app:   Attendance page → the sync pill should go green"
echo "                   within about a minute, even with nobody punching."
echo ""
echo "  ─────────────────────────────────────────────────────────────────"
echo "  ONE STEP LEFT. The department's power is cut every night, and a"
echo "  hard power-off will eventually corrupt this SD card. Once the pill"
echo "  is green, make the card read-only so there is nothing to corrupt:"
echo ""
echo "      sudo raspi-config"
echo "        → Performance Options → Overlay File System → enable"
echo "        → reboot"
echo ""
echo "  The puller re-sends the last 24h on each boot, which is harmless —"
echo "  punches overwrite themselves. See README.txt, \"MAKE IT SURVIVE"
echo "  THE NIGHTLY POWER CUT\", before changing anything later."
echo "  ─────────────────────────────────────────────────────────────────"
