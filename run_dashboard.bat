@echo off
echo ========================================================
echo   Launching SaaS Dashboard & Dynamic Island Overlay
echo ========================================================
echo.

cd apps\dashboard

if not exist "node_modules" (
    echo [1/2] Installing dashboard dependencies...
    call npm install
)

echo [2/2] Starting Electron Developer Environment...
echo - Dashboard UI on http://localhost:5178
echo - Dynamic Island Overlay ready
echo - System Tray enabled
echo.
call npm run electron:dev

pause
