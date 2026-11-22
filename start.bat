@echo off
rem XO LAB - double-click to run on Windows. Opens http://localhost:8080 in your browser.
cd /d "%~dp0"
set PORT=8080
echo XO LAB - http://localhost:%PORT%/   (close this window to stop)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/"
where node >nul 2>nul
if %errorlevel%==0 (
  node scripts\serve.mjs %PORT%
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\serve.ps1 %PORT%
)
pause
