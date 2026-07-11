@echo off
cd /d "%~dp0"
> "%~dp0_ls_probe.txt" 2>&1 python\ls-venv\Scripts\python -c "import label_studio; print('OK', label_studio.__version__)"
