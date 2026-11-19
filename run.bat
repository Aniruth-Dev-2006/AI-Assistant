@echo off
echo ================================================
echo   AI Interview Assistant (v3 Local Pipeline)
echo ================================================
echo.

if not exist "node_modules" (
    echo [Setup] Installing dependencies...
    call npm install
)

echo [Launch] Starting Electron Overlay...
call npm start

pause
