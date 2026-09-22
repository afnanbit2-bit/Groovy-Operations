GROOVY ATTENDANCE SYNC
======================

The K40 clock's punches have to reach Firebase. There are three ways to do
that. Only one of them is recommended.

  1. RASPBERRY PI  (pull.js)        ← RECOMMENDED, use this
     A small always-on box on the same network as the clock. Reads the clock
     directly over TCP/IP and forwards punches to the app. No PC, nobody
     logged in, starts itself on boot.

  2. DEVICE PUSH / ADMS             ← try only if you cannot place a Pi
     The clock posts to the internet by itself, no hardware at all. The
     server side is built and tested, but many K40 firmwares speak HTTP only
     and our endpoint is HTTPS-only, so the clock may simply never connect.
     See "ADMS" at the bottom.

  3. WINDOWS PC  (sync.js)          ← the old way, being retired
     Reads the ZKTeco Access database on Mustafa's PC. This is the one that
     "mostly results in errors" — the Jet OLEDB driver — and it only syncs
     while that one PC is on and logged in. Kept for fallback only.


===========================================================================
1. RASPBERRY PI SETUP
===========================================================================

WHAT TO BUY
  • Any Raspberry Pi (a Pi Zero 2 W or a Pi 3/4/5 are all plenty)
  • Its power supply
  • A microSD card, 16 GB or more
  • Ethernet cable if you are not using Wi-Fi (more reliable — prefer it)

The Pi must be able to reach BOTH the clock on the local network AND the
internet.

ONE-TIME SETUP
  1. Flash "Raspberry Pi OS Lite (64-bit)" to the SD card with the
     Raspberry Pi Imager. In the Imager's settings gear, switch on SSH and
     set a username and password — otherwise you cannot log in.

  2. Plug the Pi in, on the same network as the clock. Log in over SSH.

  3. Get the code and run the installer:

       sudo apt-get update && sudo apt-get install -y git
       git clone https://github.com/afnanbit2-bit/Groovy-Operations.git
       cd Groovy-Operations/attendance-sync
       bash setup-pi.sh

     If the clock is NOT at the default 192.168.100.201, pass its address:

       ZK_IP=192.168.1.50 bash setup-pi.sh

     (The clock shows its own IP under Menu → Comm. → Ethernet.)

  4. That is all. The installer sets the timezone, installs Node, checks the
     clock answers, and registers the puller as a service that starts on
     every boot and restarts itself if it ever crashes.

CHECK IT IS WORKING
  Open the app → Attendance page. The sync pill in the top-right should go
  green within about a minute — EVEN IF NOBODY IS PUNCHING. The puller sends
  a heartbeat every 60 seconds whether or not there are new punches, so:

    green   = the Pi is alive and talking to both the clock and the app
    orange  = it has stopped reporting — the Pi is off, crashed, or offline
    red     = it reported an error; hover for the message

  On the Pi itself:
    sudo systemctl status groovy-attendance     is it running?
    journalctl -u groovy-attendance -f          live log of punches
    sudo systemctl restart groovy-attendance    restart it

IF SOMETHING IS WRONG
  • Pill orange/never, and `systemctl status` says the service is dead:
      journalctl -u groovy-attendance -n 40 --no-pager
  • Log says "pull error: ..." repeatedly:
      The Pi cannot reach the clock. Check the clock is on, on the same
      network, and that its IP has not changed (DHCP can move it — give the
      clock a static IP, or a DHCP reservation on the router).
  • Log says "HTTP 502" or "unexpected reply":
      The Pi reached the app but the app refused. Nothing is lost — the
      puller does NOT advance its cursor on a failed send, so those punches
      go again on the next tick. If it persists, the Netlify deploy is
      probably broken.
  • The clock's IP changed:
      sudo systemctl edit --full groovy-attendance   (edit ZK_IP), then
      sudo systemctl restart groovy-attendance

TO RESET THE CURSOR (if records seem stuck)
  sudo systemctl stop groovy-attendance
  rm last_pull.json
  sudo systemctl start groovy-attendance
  It will re-pull the last 24 hours. Re-sending a punch is harmless — each
  one is stored under its own timestamp, so a repeat overwrites itself.


KNOWN LIMITATION — IN vs OUT IS A GUESS
  The ZK network protocol does not send whether a punch was an entry or an
  exit; the record carries only a user id and a time. The puller therefore
  alternates per person per day: 1st punch = in, 2nd = out, 3rd = in, and so
  on, resetting at midnight. Two reads of the same badge within a minute are
  treated as one punch, so a double-tap does not flip the rest of the day.

  WORKING HOURS DO NOT DEPEND ON THIS. The app computes them from the first
  and last punch of the day, so if the guess is ever wrong it costs only the
  live "who is currently in" dot, never payroll.


===========================================================================
2. ADMS / DEVICE PUSH  (no hardware)
===========================================================================

The receiver is already built and deployed (netlify/functions/iclock.js).
Try it before buying a Pi if you would rather have no extra hardware.

  Test the endpoint answers — this writes nothing:
    curl -i "https://groovyoperations.netlify.app/iclock/cdata?SN=TEST&options=all"
  Expect 200 and a block of settings containing Realtime=1.

  Then on the clock: Menu → Comm. → Ethernet (static IP, gateway, and a
  working DNS), then Menu → Comm. → Cloud Server / ADMS:
    Enable Domain Name : ON
    Server Address     : groovyoperations.netlify.app
    Server Port        : 443
    Enable Proxy       : OFF
  Reboot the clock and punch once.

  If nothing arrives, the firmware almost certainly cannot do HTTPS. That is
  not fixable from our side — use the Pi.


===========================================================================
3. WINDOWS PC  (legacy — sync.js)
===========================================================================

  1. Install Node.js from https://nodejs.org (LTS, defaults, restart the PC)
  2. Double-click install.bat in this folder
  3. Sync then starts automatically whenever that PC is switched on

  Problems: check Task Manager → Details for node.exe, and read
  sync_log.txt in this folder. Common cause of errors is the K40 being
  disconnected inside the ZKTeco desktop software.

  To reset its cursor: stop the script, delete last_sync.json, re-run.
