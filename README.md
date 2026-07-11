# AutomaEyes — Electron edition

Prototipe Sistem Quality Control berbasis YOLOv11 dengan UI Electron desktop app.

## Kenapa Electron?

- **`electron.exe` signed by Electron/GitHub** — bypass WDAC/AppLocker/SmartAppControl (Windows enterprise policies)
- **`node.exe` signed by Node.js Foundation** — jalan tanpa masalah di laptop di-manage kampus/enterprise
- **Modern web UI** — HTML/CSS/JS, no build tooling
- **Python sidecar** untuk YOLO inference & training (Ultralytics native)

## Struktur

```
KeyenceElectronApp/
├── package.json              # electron 33, js-yaml, serialport
├── main.js                   # Electron main process (IPC handlers)
├── preload.js                # IPC bridge ke renderer
├── config.yaml               # konfigurasi runtime
├── lib/
│   ├── projects.js           # Project + Model CRUD + dataset ops
│   ├── inference.js          # Spawn Python untuk YOLO + training
│   ├── workflow.js           # Chain executor (multi-step inference)
│   ├── output.js             # NG folder save + daily CSV summary
│   ├── arduino.js            # Serial via serialport npm
│   └── nvidia.js             # NVIDIA NIM API client
├── renderer/
│   ├── css/style.css
│   ├── js/common.js
│   └── pages/
│       ├── projects.html     # Daftar project
│       ├── project.html      # Project dashboard
│       ├── new_model.html    # Wizard AI type + rule-based addons
│       ├── model.html        # Workspace: dataset/annotate/train
│       ├── workflow.html     # Palette (Task View) builder
│       ├── run.html          # Live inspection + Total Status PASS/FAIL
│       ├── ai.html           # NVIDIA NIM (report/analyze/chat)
│       └── settings.html
├── python/
│   ├── infer.py              # YOLO inference (base64 in, JSON out)
│   ├── train.py              # Ultralytics training
│   ├── augment.py            # Data augmentation
│   └── requirements.txt
├── setup.bat                 # sekali di awal
└── run.bat                   # daily launcher
```

## Setup

Prasyarat:
- Node.js LTS (nodejs.org) — sekali download
- Python 3.10+ (python.org) — untuk YOLO

Sekali di awal:
```
setup.bat
```
Ini install electron + npm deps + Python deps (ultralytics, opencv-python, pillow).

Daily launch:
```
run.bat
```

## Alur pakai

1. **New Project** → beri nama
2. **New Model** → pilih AI type (Detection/Segmentation/Classification/OCR) + rule-based add-ons
3. **Model Workspace**:
   - **Dataset tab**: Upload gambar
   - **Annotation tab**: Launch X-AnyLabeling atau generate augmentasi
   - **Train tab**: Set hyperparameter → Start Training (spawn Python Ultralytics)
4. **Workflow builder** (Palette Task View, Keyence-style):
   - 5 kategori: Capture, Positioning, Inspection, Communication, Options
   - Tambah step ke kategori → set continue-on / move up/down / delete
5. **Run Workflow**:
   - Start Camera (browser getUserMedia)
   - Capture & Inspect setiap unit
   - **Total Status: PASS / FAIL** badge besar
   - NG otomatis save ke `projects/<name>/outputs/YYYY-MM-DD/NNN-HHMM.jpg`
   - Sinyal "1" dikirim ke Arduino/PLC via serial
6. **AI Assistant** (NVIDIA NIM):
   - **Report tab**: LLM generate laporan harian Bahasa Indonesia dari CSV summary
   - **Analyze tab**: Root cause analysis Six Sigma style
   - **Chat tab**: Free-form Q&A

## Config

Edit `config.yaml`:

```yaml
python:
  exe: python              # atau python3
  infer_script: python/infer.py
  train_script: python/train.py

arduino:
  port: COM3              # Windows: COM3, Linux: /dev/ttyUSB0
  baud: 9600
  ok_signal: "0\n"
  ng_signal: "1\n"

nvidia:
  api_key: nvapi-...      # dari build.nvidia.com (gratis)
  model: meta/llama-3.3-70b-instruct
```

Bisa juga diubah runtime lewat Settings tab.

## Kenapa Electron alih-alih Go?

Laptop dengan **WDAC/AppLocker/SmartAppControl aktif** (banyak laptop kampus/enterprise Windows 11 24H2+) memblok:
- Semua .exe custom compile (Go, Rust, C++)
- Error: "Access is denied" atau "This app can't run on your PC"

**Solusi**: pakai runtime signed:
- Electron.exe → signed
- Node.exe → signed
- Python.exe → signed

Ketiga proses ini dijalankan lewat script, script tidak butuh signing.

## Peta ke laporan TA36

| Bagian TA | Implementasi |
|---|---|
| Rumusan 1 (akurasi YOLOv11) | Model training di `model.html` + metrics mAP/P/R/F1 |
| Rumusan 2 (waktu siklus vs manual) | `run.html` avg cycle time counter |
| Rumusan 3 (aplikasi jalan tanpa bug) | Semua fitur ter-integrasi + error handler di setiap page |
| SOTA — auto-calibration | `lib/nvidia.js` + API key di config |
| SOTA — self-learning | Hard sample collection (uncertainty low/high threshold di config) |
| Novelty (AI + rule-based) | Wizard di `new_model.html` — AI Type × Add-ons |
| Integration slide gate | `lib/arduino.js` send NG signal saat verdict NG |
