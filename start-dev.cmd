@echo off
setlocal

cd /d "%~dp0"

REM Open the app in the default browser (Vite uses 5173 by default).
start "" "http://localhost:5173/"

REM Start the dev server (close this window to stop it).
npm run dev

