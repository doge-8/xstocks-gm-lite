@echo off
node say-gm.js
if %errorlevel% neq 0 (
    echo.
    echo Error occurred. See above for details.
    pause
)
