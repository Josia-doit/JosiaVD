@echo off
cls
chcp 65001 >nul 2>&1
title JosiaVD Video Downloader

echo ==============================================
echo          JosiaVD One-Click Startup
echo        Automatic Setup & Download Tools
echo ==============================================
echo.

set "NODE_PATH=node.exe"

if not exist "%NODE_PATH%" (
    echo [+] Downloading Node.js...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip' -OutFile 'node.zip'"
    powershell -Command "Expand-Archive -Path 'node.zip' -DestinationPath '.' -Force"
    move /y "node-v20.18.0-win-x64\node.exe" .\ >nul
    rmdir /s /q "node-v20.18.0-win-x64" >nul
    del /f /q "node.zip" >nul
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
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'ffmpeg.zip'"
    powershell -Command "Expand-Archive -Path 'ffmpeg.zip' -DestinationPath '.' -Force"
    move /y "ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" .\ >nul
    rmdir /s /q "ffmpeg-master-latest-win64-gpl" >nul
    del /f /q "ffmpeg.zip" >nul
    echo [+] ffmpeg downloaded!
    echo.
)

if not exist "yt-dlp.exe" (
    echo [+] Downloading yt-dlp.exe...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile 'yt-dlp.exe'"
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
