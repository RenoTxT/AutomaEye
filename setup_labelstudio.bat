@echo off
setlocal
cd /d "%~dp0"
echo ================================================================
echo   Install Label Studio ke venv terpisah (python\ls-venv)
echo   Terpisah dari ultralytics supaya dependency tidak bentrok.
echo ================================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [X] Python tidak ditemukan di PATH. Install Python 3.10-3.12 dulu.
    pause & exit /b 1
)

if not exist python\ls-venv (
    echo [..] Membuat virtual-env python\ls-venv ...
    python -m venv python\ls-venv
)

echo [..] Upgrade pip ...
python\ls-venv\Scripts\python -m pip install --upgrade pip

echo [..] Install label-studio ^(~300 MB, bisa beberapa menit^) ...
python\ls-venv\Scripts\python -m pip install -r python\requirements-labelstudio.txt
if errorlevel 1 (
    echo.
    echo [X] Gagal install label-studio. Lihat pesan error di atas.
    pause & exit /b 1
)

echo.
echo [OK] Label Studio terpasang di python\ls-venv
echo      Buka app -^> Annotation -^> Start Label Studio Server.
pause
