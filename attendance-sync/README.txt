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
  • A Raspberry Pi 4 (2GB) or a Pi 3 Model B+ — anything with a real
    ethernet port. The work is trivial; do not pay for RAM or cores.
  • Its official power supply (cheap chargers cause SD corruption)
  • A HIGH-ENDURANCE microSD card, 32 GB (SanDisk Max Endurance, Samsung
    PRO Endurance or similar — the sort sold for dashcams and CCTV)
  • Ethernet cable — prefer it over Wi-Fi for something nobody watches

The Pi must be able to reach BOTH the clock on the local network AND the
internet.

  BEFORE BUYING: an old laptop or mini PC does this job just as well, and a
  laptop is BETTER here, because its battery means the nightly power cut is
  a clean shutdown instead of a yank. pull.js is only a Node script. If one
  is spare, use it and skip the shopping.

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

MAKE IT SURVIVE THE NIGHTLY POWER CUT  ← DO NOT SKIP THIS
  The department's power is cut every evening and switched on every morning.
  That is roughly 250 hard power-offs a year on a running Linux box, and it
  WILL corrupt an ordinary SD card — usually within months. This is the most
  common way a Raspberry Pi dies, and here it is guaranteed rather than bad
  luck.

  The fix is to make the card read-only, so a power cut has nothing to
  damage. Raspberry Pi OS has this built in. AFTER running setup-pi.sh and
  confirming the pill goes green:

    sudo raspi-config
      → Performance Options → Overlay File System
      → enable the overlay, and set the boot partition read-only
      → reboot

  From then on every write goes to RAM and is thrown away at power-off. The
  card is never written to, so it cannot be corrupted by losing power.

  WHAT THIS COSTS, AND WHY IT IS FINE
  • last_pull.json is discarded each night, so every morning the puller
    falls back to its 24-hour window and re-sends punches the app already
    has. This is harmless: each punch is stored under its own timestamp, so
    re-sending overwrites it with itself. It cannot create duplicates.
    (tests/attendance-puller.test.js pins that — if it ever stops being
    true, this setup stops being safe with it.)
  • Log history is lost on reboot, so `journalctl` only shows today. You do
    not need it for "is it alive" — the app's sync pill answers that, and it
    is visible from anywhere.

  TO CHANGE ANYTHING LATER (update the code, change the clock's IP), turn
  the overlay OFF in raspi-config, reboot, make the change, turn it back on,
  reboot. Forgetting to turn it back on is the easy mistake: the Pi will run
  fine for months and then eat its card.

  NOTHING IS LOST OVERNIGHT. The clock keeps its own punches in its own
  memory, so anything recorded while the Pi is off — or in the minute it
  takes to boot — is picked up on the next pull. Nobody has to be careful
  about the order things are switched on.

  THE HOURS THIS IS SIZED FOR
  The department opens between 9am and 11am and closes between 8pm and
  midnight, so the Pi is off for somewhere between 9 and 15 hours. A cold
  start reaches back 48 HOURS, which clears the longest overnight gap, and
  a weekend, with room to spare. It is not longer than that because with a
  read-only card this replay runs EVERY morning, and it is sent to the app
  in batches of 50 punches — the receiver writes each punch to the database
  one at a time inside a function call capped at ten seconds, so a whole
  morning in a single request would time out, fail, and retry forever.

  IF THE PI IS DOWN FOR MORE THAN 48 HOURS
  (card died, unplugged, left off over a long holiday while people were
  still punching.) The clock still has every punch, but a normal cold start
  only reaches back two days, so the app would be missing the rest. You
  will know this happened because the sync pill sits orange the whole time.
  To catch up, reach back further just once:

    sudo systemctl stop groovy-attendance
    cd ~/Groovy-Operations/attendance-sync
    ZK_BACKFILL_HOURS=720 node pull.js        # 720h = 30 days
    # wait for one "forwarded N punch(es)" line, then press Ctrl+C
    sudo systemctl start groovy-attendance

  Re-sending punches the app already has is harmless — they overwrite
  themselves — so it is always safe to reach back further than you need.


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
  rm -f last_pull.json
  sudo systemctl start groovy-attendance
  It will re-pull the last 48 hours. Re-sending a punch is harmless — each
  one is stored under its own timestamp, so a repeat overwrites itself.
  (With the read-only overlay on, the file is already discarded at every
  power cut, so this happens by itself every morning.)


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
