@echo off
cd /d "%~dp0"
if not exist "node_modules" (
    echo 首次运行，正在安装依赖...
    call install.bat
    if errorlevel 1 (
        echo 依赖安装失败
        pause
        exit /b 1
    )
)
node say-gm.js
if %errorlevel% neq 0 (
    echo.
    echo Error occurred. See above for details.
    pause
)
