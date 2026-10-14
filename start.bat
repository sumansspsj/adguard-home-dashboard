@echo off
echo Starting AdGuard Dashboard...
echo.

REM Start API server in background
echo [1/2] Starting API server on port 8080...
start "AdGuard API" cmd /c "cd /d %~dp0server && node index.js"

REM Wait a moment
timeout /t 2 /nobreak >nul

REM Start frontend
echo [2/2] Starting dashboard on http://localhost:5173
echo.
echo Open your browser to: http://localhost:5173
echo.
cd /d %~dp0dashboard
npm run dev
