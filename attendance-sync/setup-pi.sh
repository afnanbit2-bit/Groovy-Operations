#!/usr/bin/env bash
# ── One-shot Raspberry Pi installer for the Groovy attendance puller ────────
# Installs Node.js, the puller's deps, and registers pull.js as a systemd
# service that starts on boot and auto-restarts if it ever crashes.
#
#   Run once on a fresh Raspberry Pi OS:
#     cd Groovy-Operations/attendance-sync && bash setup-pi.sh
#
# After this the clock syncs 24/7 with no PC. Useful commands:
#   sudo systemctl status  groovy-attendance     # is it running?
#   journalctl -u groovy-attendance -f           # live log of punches
#   sudo systemctl restart groovy-attendance     # restart it
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(whoami)"

echo "→ Installing Node.js…"
sudo apt-get update -y
sudo apt-get install -y nodejs npm

echo "→ Installing puller dependencies…"
( cd "$DIR" && npm install )

NODE_BIN="$(command -v node || echo /usr/bin/node)"

echo "→ Registering the auto-start service…"
sudo tee /etc/systemd/system/groovy-attendance.service >/dev/null <<EOF
[Unit]
Description=Groovy K40 Attendance Puller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
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

echo ""
echo "✓ Done. The puller is running and will start on every boot."
echo "  Watch it live:  journalctl -u groovy-attendance -f"
