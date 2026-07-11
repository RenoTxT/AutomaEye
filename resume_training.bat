@echo off
setlocal
cd /d "%~dp0"
set "CKPT=projects\SH1160\models\Object Detector\runs\train\weights\last.pt"
echo ================================================================
echo   Resume training AutomaEyes  (epoch 78 -^> 100)
echo   Checkpoint: %CKPT%
echo ================================================================
echo.
if not exist "%CKPT%" (
    echo [X] last.pt tidak ditemukan. Cek path di atas. Batal.
    pause ^& exit /b 1
)
where python >nul 2>&1
if errorlevel 1 (
    echo [X] python tidak ada di PATH. Buka lewat run.bat / install Python dulu.
    pause ^& exit /b 1
)
echo [..] Melanjutkan training dari checkpoint. Biarkan jendela ini terbuka...
python -c "from ultralytics import YOLO; YOLO(r'%CKPT%').train(resume=True)"
if errorlevel 1 (
    echo.
    echo [X] Resume gagal. Lihat pesan error di atas.
    pause ^& exit /b 1
)
echo.
echo [..] Menyalin best.pt ke folder model supaya app bisa memakainya...
if not exist "projects\SH1160\models\Object Detector\weights" mkdir "projects\SH1160\models\Object Detector\weights"
copy /Y "projects\SH1160\models\Object Detector\runs\train\weights\best.pt" "projects\SH1160\models\Object Detector\weights\best.pt" >nul
echo.
echo [OK] Training selesai 100 epoch.
echo      Model siap dipakai app: projects\SH1160\models\Object Detector\weights\best.pt
pause
