@echo off
echo ========================================================
echo Starting AI Meet Assistant Developer Environment
echo ========================================================
echo.

:: 1. Start the Backend Server (WebRTC audio diagnostics enabled)
echo Starting Backend Server (DEBUG_WEBRTC_AUDIO=1)...
start "AI Meet Backend Server" cmd /k "cd apps\server && set DEBUG_WEBRTC_AUDIO=1 && node index.js"

:: 2. Start Ngrok for Google Webhooks
echo Starting Ngrok Tunnel (Port 8080)...
start "Ngrok Webhook Tunnel" cmd /k "ngrok http --domain=sclerodermatous-effervescingly-caryl.ngrok-free.dev 8080"

echo.
echo ========================================================
echo Backend services launched in separate windows!
echo.
echo NEXT STEPS:
echo 1. Look at the "Ngrok Webhook Tunnel" window.
echo 2. Copy the Forwarding HTTPS URL if WEBHOOK_BASE_URL changed.
echo 3. Reload the Chrome extension.
echo 4. Join a Meet/Zoom/Teams call and start the bot as usual.
echo 5. WebRTC diagnostic banners appear in "AI Meet Backend Server".
echo    JSONL files: apps\bot\.diag\
echo ========================================================
pause
