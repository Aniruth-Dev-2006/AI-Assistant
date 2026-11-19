@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo Missing .env — copy .env.example to .env and fill keys first.
  exit /b 1
)

echo Building and starting Xobin Meet API container...
docker compose up -d --build
if errorlevel 1 (
  echo Docker Compose failed. Is Docker Desktop running?
  exit /b 1
)

echo.
echo API:      http://localhost:8080/health
echo Dashboard: http://localhost:8080/app/
echo.
echo Other device on same Wi-Fi:
echo   1. Find this PC IP: ipconfig
echo   2. Open extension popup - set Server URL to http://YOUR_IP:8080
echo   3. Allow port 8080 in Windows Firewall if needed
echo.
docker compose ps
endlocal
