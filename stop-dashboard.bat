@echo off
echo Stopping AdGuard Dashboard background processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(8080, 5173); $pids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($pids) { foreach ($p in $pids) { try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped dashboard process with PID ' + $p) } catch {} } } else { Write-Host 'No active dashboard listeners found on ports 8080 or 5173.' }"
echo Done.
pause
