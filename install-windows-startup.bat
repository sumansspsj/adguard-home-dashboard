@echo off
set "SCRIPT_DIR=%~dp0"
echo Adding AdGuard Dashboard to Windows Startup...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Startup') + '\AdGuardHomeDashboard.lnk'); $sc.TargetPath = 'wscript.exe'; $sc.Arguments = '\"%SCRIPT_DIR%run-hidden.vbs\"'; $sc.WorkingDirectory = '%SCRIPT_DIR%'; $sc.Save()"
echo.
echo ========================================================
echo   [SUCCESS] AdGuard Dashboard installed to Startup!
echo   It will now automatically launch in the background
echo   every time your PC turns on.
echo   Access anytime at: http://localhost:5173
echo   (Also active on  : http://localhost:8080)
echo ========================================================
pause
