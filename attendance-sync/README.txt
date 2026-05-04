GROOVY ATTENDANCE SYNC — MUSTAFA SETUP
=======================================

FIRST TIME ONLY:
1. Install Node.js from: https://nodejs.org
   (Click LTS version, install with all defaults, restart PC)

2. Open this folder in File Explorer
3. Double-click: install.bat
4. Wait for it to finish
5. Done forever — sync starts automatically on every PC startup

TO CHECK IF WORKING:
Open groovyoperations.netlify.app → Attendance page.
Top-right corner shows a sync status pill:
  🟢 Sync OK · 1m ago        — everything is working
  🟠 Sync stale · 25m ago    — script alive but hasn't pushed in a while
  🔴 Sync error · 2m ago     — script ran but hit an error (hover for details)
  ⚠️ Sync: never ran          — no heartbeat ever; script not running on PC

PROBLEMS?
- Pill is 🟠 stale or ⚠️ never:
   • Check this PC is on and logged in
   • Open Task Manager → Details → look for node.exe; if missing,
     re-run install.bat to restart the scheduled task
   • Open sync_log.txt in this folder to see the last messages
- Pill is 🔴 error:
   • Hover the pill in the app to see the error message
   • Common cause: K40 disconnected from ZKTeco software → reconnect
- Black window shows error → send screenshot of sync_log.txt to Afnan
- No data on dashboard → check K40 is connected in ZKTeco software

TO RESET THE CURSOR (if records seem stuck):
1. Stop the script (close the black window or end node.exe)
2. Delete last_sync.json in this folder
3. Re-run sync.js (double-click) or wait for next scheduled-task run
   The script will pull the last 24 hours fresh.
