@echo off
setlocal
REM =====================================================================
REM  KeyenceQC Electron — first-time setup.
REM  Semua exe yang jalan (node.exe, electron.exe) sudah signed jadi
REM  WDAC/AppLocker/SmartAppControl tidak block.
REM =====================================================================

cd /d "%~dp0"

echo ================================================================
echo   KeyenceQC Electron — Setup
echo ================================================================
echo.

REM ---------- 1. Cek Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js tidak ditemukan.
    echo     Download LTS: https://nodejs.org/
    echo     Install ^(default settings^), restart terminal, jalankan setup.bat lagi.
    pause & exit /b 1
)
for /f "tokens=1" %%a in ('node --version') do set NODEVER=%%a
echo [OK] Node.js %NODEVER%

where npm >nul 2>&1
if errorlevel 1 (
    echo [X] npm tidak ditemukan. Reinstall Node.js.
    pause & exit /b 1
)

REM ---------- 2. Cek Python ----------
where python >nul 2>&1
if errorlevel 1 (
    echo [X] Python tidak ditemukan.
    echo     Download Python 3.10+: https://www.python.org/downloads/
    pause & exit /b 1
)
for /f "tokens=2" %%a in ('python --version') do set PYVER=%%a
echo [OK] Python %PYVER%

REM ---------- 3. Install npm packages ----------
echo.
echo [..] npm install electron + dependencies ^(~2-5 menit^)...
npm install
if errorlevel 1 (
    echo [X] npm install gagal. Cek error di atas.
    pause & exit /b 1
)
echo [OK] npm packages siap

REM ---------- 4. Install Python deps ----------
echo.
echo [..] Install Python deps ^(ultralytics, opencv, pillow, numpy^)...
python -m pip install -r python\requirements.txt
if errorlevel 1 (
    echo [X] pip install gagal.
    pause & exit /b 1
)
echo [OK] Python deps siap

REM ---------- 4b. Label Studio di virtual-env TERPISAH (anti bentrok deps) ----------
REM  Label Studio mengunci versi lama numpy/pydantic yang bentrok dengan ultralytics.
REM  Karena itu dipasang di venv sendiri (python\ls-venv), bukan environment utama.
echo.
echo [..] Menyiapkan Label Studio di venv terpisah python\ls-venv ^(~300 MB, sabar^)...
if not exist python\ls-venv (
    python -m venv python\ls-venv
)
python\ls-venv\Scripts\python -m pip install --upgrade pip >nul 2>&1
python\ls-venv\Scripts\python -m pip install -r python\requirements-labelstudio.txt
if errorlevel 1 (
    echo [!] Label Studio gagal di-install. Anotasi in-app tidak jalan,
    echo     tapi training/run tetap bisa. Ulangi kapan saja dgn: setup_labelstudio.bat
) else (
    echo [OK] Label Studio siap di python\ls-venv
)

REM ---------- 5. Siapkan model ----------
if not exist models mkdir models
if not exist projects mkdir projects

if not exist models\best.pt (
    echo.
    echo [!] models\best.pt belum ada.
    echo     Copy file .pt hasil training ke folder models\ dulu.
    echo     Contoh:
    echo       copy "..\best_rust.pt" models\best.pt
)

echo.
echo ================================================================
echo   Setup selesai! Sekarang jalankan:
echo     run.bat
echo ================================================================
pause
