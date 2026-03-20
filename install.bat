@echo off
echo Checking Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)
echo Installing dependencies, please wait...
call npm install
echo.
echo Install complete.
pause
