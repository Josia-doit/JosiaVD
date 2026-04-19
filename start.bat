@echo off
cls
chcp 65001 >nul 2>&1
title JosiaVD Video Downloader
echo ==============================================
echo          JosiaVD Video Downloader
echo                One-Click Startup
echo ==============================================
echo.

set "NODE_PATH=node.exe"
if not exist "%NODE_PATH%" (
    echo [+] Downloading Node.js...
    call :downloadNode
    if errorlevel 1 (
        echo [!] Failed to download Node.js
        echo [!] Please check your network connection
        pause
        exit /b 1
    )
    echo [+] Node downloaded successfully!
    echo.
)

if not exist "node_modules" (
    echo [+] Installing dependencies...
    echo.
    call npm.cmd install
    echo.
    echo [+] Dependencies installed!
    echo.
)

if not exist "ffmpeg.exe" (
    echo [+] Downloading ffmpeg.exe...
    call :downloadFFmpeg
    if errorlevel 1 (
        echo [!] Failed to download ffmpeg.exe
        echo [!] Please check your network connection
        pause
        exit /b 1
    )
    echo [+] ffmpeg downloaded!
    echo.
)

if not exist "yt-dlp.exe" (
    echo [+] Downloading yt-dlp.exe...
    call :downloadYtDlp
    if errorlevel 1 (
        echo [!] Failed to download yt-dlp.exe
        echo [!] Please check your network connection
        pause
        exit /b 1
    )
    echo [+] yt-dlp downloaded!
    echo.
)

echo [+] Starting server...
echo.
start /B %NODE_PATH% server.js
timeout /t 2 /nobreak >nul
start http://localhost:3000
echo ==============================================
echo [+] Server started: http://localhost:3000
echo [+] Videos saved to downloads folder
echo [!] Close this window to stop server
echo ==============================================
echo.
pause >nul
taskkill /F /IM node.exe >nul 2>&1
exit /b 0

:downloadNode
set "NODE_VERSION=v20.18.0"
set "NODE_FILE=node-%NODE_VERSION%-win-x64.zip"
set "MIRROR1=https://npmmirror.com/mirrors/node/%NODE_VERSION%/%NODE_FILE%"
set "MIRROR2=https://nodejs.org/dist/%NODE_VERSION%/%NODE_FILE%"

for %%M in ("%MIRROR1%" "%MIRROR2%") do (
    echo [+] Trying mirror: %%~M
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%%~M' -OutFile 'node.zip' -UseBasicParsing -TimeoutSec 60"
    if exist "node.zip" (
        powershell -Command "Expand-Archive -Path 'node.zip' -DestinationPath '.' -Force"
        if exist "node-%NODE_VERSION%-win-x64\node.exe" (
            move /y "node-%NODE_VERSION%-win-x64\node.exe" .\ >nul
            rmdir /s /q "node-%NODE_VERSION%-win-x64" >nul
            del /f /q "node.zip" >nul
            exit /b 0
        )
    )
    if exist "node.zip" del /f /q "node.zip" >nul
)
exit /b 1

:downloadFFmpeg
set "MIRROR1=https://hub.gitmirror.com/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
set "MIRROR2=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"

for %%M in ("%MIRROR1%" "%MIRROR2%") do (
    echo [+] Trying mirror: %%~M
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%%~M' -OutFile 'ffmpeg.zip' -UseBasicParsing -TimeoutSec 120"
    if exist "ffmpeg.zip" (
        powershell -Command "Expand-Archive -Path 'ffmpeg.zip' -DestinationPath '.' -Force"
        if exist "ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" (
            move /y "ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" .\ >nul
            rmdir /s /q "ffmpeg-master-latest-win64-gpl" >nul
            del /f /q "ffmpeg.zip" >nul
            exit /b 0
        )
    )
    if exist "ffmpeg.zip" del /f /q "ffmpeg.zip" >nul
)
exit /b 1

:downloadYtDlp
set "MIRROR1=https://hub.gitmirror.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
set "MIRROR2=https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"

for %%M in ("%MIRROR1%" "%MIRROR2%") do (
    echo [+] Trying mirror: %%~M
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%%~M' -OutFile 'yt-dlp.exe' -UseBasicParsing -TimeoutSec 60"
    if exist "yt-dlp.exe" (
        for %%F in (yt-dlp.exe) do if %%~zF gtr 1000000 exit /b 0
        del /f /q "yt-dlp.exe" >nul
    )
)
exit /b 1
