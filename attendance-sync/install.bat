@echo off
echo Installing Groovy Attendance Sync...
echo.
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js not found.
  echo Please download from https://nodejs.org and install, then run this file again.
  pause
  exit
)
echo Node.js found OK.
echo Installing dependencies...
npm install
echo.
echo Setting up auto-start on Windows login...
schtasks /create /tn "GroovyAttendanceSync" /tr "cmd /c cd /d \"%~dp0\" && node sync.js >> sync_log.txt 2>&1" /sc onlogon /ru "%USERNAME%" /f
echo.
echo Done! Sync will start automatically every time this PC turns on.
echo Running first sync now...
echo.
node sync.js
pause
