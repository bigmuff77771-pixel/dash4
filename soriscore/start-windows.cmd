@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js LTS from https://nodejs.org and try again.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
start "" http://localhost:5173
call npm run preview -- --port 5173
exit /b
:failed
echo Setup failed. Check the message above.
pause
exit /b 1
