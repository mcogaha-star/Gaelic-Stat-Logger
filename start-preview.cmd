@echo off
setlocal

cd /d "%~dp0"

REM Build once, then run the production-like preview server.
call npm run build

start "" "http://localhost:4173/"
npm run preview

