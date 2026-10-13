@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20 或更高版本，然后重新双击本文件。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 第一次运行：正在安装程序依赖，请保持网络连接……
  call npm install
  if errorlevel 1 (
    echo.
    echo 安装失败。请检查网络、VPN 或 npm 代理设置后重试。
    pause
    exit /b 1
  )
)

echo.
echo Phrase Compass 正在启动……
echo 浏览器将打开 http://localhost:3000
echo 要停止网站，请回到此窗口并按 Ctrl+C。
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000'"
call npm run dev

echo.
echo Phrase Compass 已停止。
pause
