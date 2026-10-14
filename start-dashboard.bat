@echo off
title AdGuard Home Dashboard
cd /d "%~dp0server"
echo ========================================================
echo   Starting AdGuard Home Unified Dashboard & AI Copilot
echo ========================================================
echo   Dashboard URL: http://localhost:5173
echo   Alternate URL: http://localhost:8080
echo ========================================================
node index.js
pause
