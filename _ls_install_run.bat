@echo off
cd /d "%~dp0"
> "%~dp0_ls_install.log" 2>&1 (
  echo [start]
  python -m venv python\ls-venv
  python\ls-venv\Scripts\python -m pip install --upgrade pip
  python\ls-venv\Scripts\python -m pip install -r python\requirements-labelstudio.txt
  python\ls-venv\Scripts\python -c "import label_studio; print('LABEL_STUDIO_OK', label_studio.__version__)"
)
echo DONE >> "%~dp0_ls_install.log"
