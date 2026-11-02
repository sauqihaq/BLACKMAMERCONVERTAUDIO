@echo off
setlocal
cd /d "%~dp0"
title BLACKMAMERSTUDIO - Roblox Audio Workspace
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js belum terinstall. Download Node.js LTS di https://nodejs.org/
 pause
 exit /b 1
)
if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules\express" (
 echo Installing Node.js dependencies...
 call npm install --no-audit --no-fund
 if errorlevel 1 (
   echo Instalasi dependency gagal. Cek koneksi internet dan jalankan npm install.
   pause
   exit /b 1
 )
)
echo.
echo BLACKMAMERSTUDIO running at http://localhost:3000
start "" "http://localhost:3000"
node server.js
if errorlevel 1 pause
