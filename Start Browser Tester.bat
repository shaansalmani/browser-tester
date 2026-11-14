@echo off
setlocal
title Browser Tester Launcher
cd /d "%~dp0"

echo ==========================================
echo        BROWSER TESTER - STARTUP
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 20.19 or newer from https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=1" %%v in ('node -p "process.versions.node"') do set NODE_VERSION=%%v
echo Node.js version: %NODE_VERSION%

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo.
  echo Installing project dependencies. This may take a few minutes...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Please send this complete error.
    pause
    exit /b 1
  )
)

if not exist "data" mkdir data

echo.
echo Starting backend...
start "Browser Tester Backend" cmd /k "cd /d ""%~dp0"" && npm.cmd run dev"

echo Waiting for backend at http://127.0.0.1:3000 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ready=$false; for($i=0;$i -lt 45;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if($r.StatusCode -ge 200){$ready=$true;break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ready){exit 1}"
if errorlevel 1 (
  echo.
  echo Backend did not become ready. Check the Backend window for errors.
  pause
  exit /b 1
)

echo Starting local Chrome Agent...
start "Browser Tester Chrome Agent" cmd /k "cd /d ""%~dp0"" && npm.cmd run agent"

timeout /t 3 /nobreak >nul
set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined CHROME_EXE (
  start "" "%CHROME_EXE%" --new-window "http://127.0.0.1:3000"
) else (
  start "" "http://127.0.0.1:3000"
)

echo.
echo Browser Tester is starting.
echo Keep both terminal windows open while using the application.
echo Close both windows to stop the local services.
echo.
pause
