@echo off
echo Removing AdGuard Dashboard from Windows Startup...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$path = [Environment]::GetFolderPath('Startup') + '\AdGuardHomeDashboard.lnk'; if (Test-Path $path) { Remove-Item $path -Force; echo 'Startup shortcut removed.' } else { echo 'No startup shortcut found.' }"
echo.
echo ========================================================
echo   [SUCCESS] Removed from Windows Startup.
echo ========================================================
pause
