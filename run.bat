@echo off
setlocal
REM =====================================================================
REM  KeyenceQC Electron — launcher.
REM  npx electron memakai node.exe + electron.exe yang sudah signed,
REM  jadi WDAC/AppLocker/SmartAppControl seharusnya tidak block.
REM =====================================================================

cd /d "%~dp0"

if not exist node_modules (
    echo [X] node_modules belum ada. Jalankan setup.bat dulu.
    pause & exit /b 1
)

echo ================================================================
echo   KeyenceQC Electron
echo ================================================================
echo.
echo Starting Electron...
echo Kalau gagal muncul window, cek console error di terminal.
echo Ctrl+C untuk stop.
echo.

npm start

if errorlevel 1 (
    echo.
    echo [X] Electron exit dengan error. Lihat pesan di atas.
    pause
)
