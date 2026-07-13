// AutomaEyes Electron main process.
//
// Peran:
//   - Buat BrowserWindow + load HTML pages
//   - Handler IPC untuk semua backend calls (project, model, workflow, dll)
//   - Spawn Python sidecar untuk YOLO inference/training
//   - Serial ke Arduino
//   - HTTP call ke NVIDIA NIM

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const projects = require('./lib/projects');
const workflow = require('./lib/workflow');
const nvidia = require('./lib/nvidia');
const arduino = require('./lib/arduino');
const inference = require('./lib/inference');
const output = require('./lib/output');
const labelstudio = require('./lib/labelstudio');
const calibration = require('./lib/calibration');
const selflearning = require('./lib/selflearning');
const gitsync = require('./lib/gitsync');

// Root repo untuk sinkronisasi = folder app (tempat main.js & .git berada)
const APP_ROOT = __dirname;
let _autoPullDone = false, _autoPullResult = null;

let mainWindow;
let cfg;
let projectsRoot; // absolute path hasil resolve saat runtime (JANGAN disimpan ke config.yaml)

// ---- Config ----
// Path deterministik ke folder app (tempat main.js berada), bukan cwd
// karena cwd tergantung dari mana `run.bat` di-launch.
const CONFIG_PATH = path.join(__dirname, 'config.yaml');

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        // config.yaml di-gitignore (berisi kunci per-device). Kalau belum ada
        // — mis. setelah clone bersih — buat otomatis dari template.
        const example = path.join(__dirname, 'config.example.yaml');
        if (fs.existsSync(example)) {
            fs.copyFileSync(example, CONFIG_PATH);
            console.log('[config] config.yaml dibuat dari config.example.yaml (isi kunci di Settings).');
        } else {
            throw new Error('config.yaml & config.example.yaml tidak ada di ' + __dirname);
        }
    }
    cfg = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
    console.log(`[config] Loaded from ${CONFIG_PATH}`);
    console.log(`[config] annotation.access_token: ${cfg.annotation?.access_token ? 'SET (' + cfg.annotation.access_token.length + ' chars)' : 'EMPTY'}`);
    // Resolve projects_root ke path absolut UNTUK RUNTIME saja.
    // PENTING: jangan mutasi cfg.paths.projects_root, karena saveConfig() menulis
    // cfg kembali ke config.yaml. Kalau dimutasi jadi absolut, path mesin ini akan
    // ter-hardcode lagi ke config.yaml dan app tidak portabel saat pindah PC.
    if (!cfg.paths) cfg.paths = {};
    if (!cfg.paths.projects_root) cfg.paths.projects_root = 'projects';
    const rawRoot = cfg.paths.projects_root;
    projectsRoot = path.isAbsolute(rawRoot) ? rawRoot : path.join(__dirname, rawRoot);
    if (!fs.existsSync(projectsRoot)) {
        fs.mkdirSync(projectsRoot, { recursive: true });
    }
    console.log(`[config] projects_root (raw): ${rawRoot}`);
    console.log(`[config] projects_root (resolved): ${projectsRoot}`);
    return cfg;
}

function saveConfig() {
    try {
        const yamlStr = yaml.dump(cfg, { lineWidth: -1, noRefs: true });
        fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
        console.log(`[config] Saved to ${CONFIG_PATH} (${yamlStr.length} bytes)`);
        return { ok: true, path: CONFIG_PATH };
    } catch (e) {
        console.error(`[config] Save FAILED: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ---- Window ----
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: cfg.app.name,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true, // enable <webview> untuk embed Label Studio
        },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.maximize();   // buka dalam keadaan maximized (memenuhi layar, title bar & taskbar tetap ada)
    mainWindow.loadFile('renderer/pages/projects.html');
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

// ---- App lifecycle ----
app.whenReady().then(() => {
    try {
        loadConfig();
    } catch (e) {
        dialog.showErrorBox('Config error', e.message);
        app.quit();
        return;
    }
    // Init services (non-fatal if fail)
    arduino.init(cfg.arduino).catch(err => console.warn('[arduino]', err.message));

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    arduino.close();
    projects.stopLabelStudioServer();
    if (process.platform !== 'darwin') app.quit();
});

// ================================================================
// IPC handlers — dipanggil dari renderer via preload.js
// ================================================================

// ---- Config ----
ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:set', (_, patch) => {
    // Deep merge: kalau patch berisi nested object (arduino, nvidia, dll),
    // merge per-field bukan replace whole object
    for (const k of Object.keys(patch)) {
        if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && cfg[k]) {
            cfg[k] = { ...cfg[k], ...patch[k] };
        } else {
            cfg[k] = patch[k];
        }
    }
    // Persist ke config.yaml supaya tetap ada di session berikutnya
    const saveResult = saveConfig();
    return { ...cfg, __save: saveResult };
});

// ---- Projects ----
ipcMain.handle('projects:list', () => projects.list(projectsRoot));
ipcMain.handle('projects:create', (_, { name, description }) =>
    projects.create(projectsRoot, name, description));
ipcMain.handle('projects:load', (_, name) =>
    projects.load(projectsRoot, name));
ipcMain.handle('projects:delete', (_, name) =>
    projects.delete(projectsRoot, name));

// ---- Models ----
ipcMain.handle('models:create', (_, { project, name, aiType, addons, classes, addonConfig }) =>
    projects.addModel(projectsRoot, project, { name, aiType, addons, classes, addonConfig }));
ipcMain.handle('models:update', (_, { project, name, patch }) =>
    projects.updateModel(projectsRoot, project, name, patch));
ipcMain.handle('models:delete', (_, { project, name }) =>
    projects.deleteModel(projectsRoot, project, name));
ipcMain.handle('models:listImages', (_, { project, model, split }) =>
    projects.listImages(projectsRoot, project, model, split || 'train'));
ipcMain.handle('models:galleryData', (_, { project, model, split }) =>
    projects.listImagesWithLabels(projectsRoot, project, model, split || 'train'));
ipcMain.handle('models:stats', (_, { project, model }) =>
    projects.modelStats(projectsRoot, project, model));

// Import existing .pt file (file picker + copy)
ipcMain.handle('models:importPt', async (_, { project, model }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Pilih file .pt (YOLO weights)',
        filters: [{ name: 'PyTorch model', extensions: ['pt'] }],
        properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return projects.importPt(projectsRoot, project, model, result.filePaths[0]);
});

// ---- Dataset ops ----
ipcMain.handle('dataset:upload', async (_, { project, model, paths: filePaths }) =>
    projects.importImages(projectsRoot, project, model, filePaths));
ipcMain.handle('dataset:deleteImages', (_, { project, model, names }) =>
    projects.deleteDatasetImages(projectsRoot, project, model, names));
ipcMain.handle('dataset:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Pilih gambar dataset',
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
        properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('dataset:augment', (event, { project, model, opts }) =>
    projects.augmentDataset(projectsRoot, project, model, opts, cfg.python,
        (p) => event.sender.send('augment:progress', { project, model, ...p })));
ipcMain.handle('dataset:split', (_, { project, model, ratios }) =>
    projects.splitDataset(projectsRoot, project, model, ratios));
ipcMain.handle('dataset:cleanRebuild', (_, { project, model, ratios }) =>
    projects.cleanRebuildDataset(projectsRoot, project, model, ratios));

// ---- Annotation: Label Studio embedded server ----
// User klik "Buka Anotasi" → server start (kalau belum) → navigate ke annotate.html
// yang embed iframe http://localhost:8080

ipcMain.handle('annotation:startServer', async () => {
    return projects.startLabelStudioServer(cfg.annotation);
});
ipcMain.handle('annotation:stopServer', () => {
    if (labelStudioWindow) {
        try { labelStudioWindow.close(); } catch (_) {}
        labelStudioWindow = null;
    }
    return projects.stopLabelStudioServer();
});
ipcMain.handle('annotation:serverStatus', () => projects.labelStudioStatus());
ipcMain.handle('annotation:datasetDir', (_, { project, model }) =>
    projects.datasetPath(projectsRoot, project, model));

// Test token — panggil API /projects/ untuk cek auth
ipcMain.handle('annotation:testAuth', () => {
    console.log(`[testAuth] token length: ${cfg.annotation.access_token?.length || 0}`);
    console.log(`[testAuth] token first 12: ${cfg.annotation.access_token?.slice(0, 12) || 'EMPTY'}...`);
    return labelstudio.testAuth(cfg.annotation.access_token);
});

// Cek existing project di Label Studio untuk model tertentu
ipcMain.handle('annotation:checkExisting', async (_, { project, model }) => {
    if (!cfg.annotation.access_token) return { found: false, error: 'no token' };
    return labelstudio.checkExistingProject(cfg.annotation.access_token, `${project} — ${model}`);
});

// Auto-setup Label Studio project untuk model tertentu (via API)
ipcMain.handle('annotation:autoSetupProject', async (_, { project, model }) => {
    if (!cfg.annotation.access_token) {
        throw new Error('Label Studio access token belum di-set. Buka Settings → Label Studio Access Token.');
    }
    const p = projects.load(projectsRoot, project);
    const m = p.models.find(x => x.name === model);
    if (!m) throw new Error('Model tidak ditemukan');

    const datasetDir = projects.datasetPath(projectsRoot, project, model);
    const imageFolder = require('path').join(datasetDir, 'images', 'train');

    return labelstudio.setupProjectForModel(
        cfg.annotation.access_token,
        `${project} — ${model}`,
        m.classes,
        imageFolder,
        `Auto-generated dari AutomaEyes project "${project}" model "${model}" (${m.type})`,
        m.type,  // <- AI type: Detection / Segmentation / Classification / OCR
    );
});

// Sync anotasi dari Label Studio ke dataset/labels/train/
ipcMain.handle('annotation:syncFromLabelStudio', async (_, { project, model, projectId }) => {
    if (!cfg.annotation.access_token) throw new Error('Access token kosong');
    const datasetDir = projects.datasetPath(projectsRoot, project, model);
    return labelstudio.extractYOLOToDataset(cfg.annotation.access_token, projectId, datasetDir);
});

// Buka Label Studio di BrowserWindow terpisah (Chromium proper, bukan iframe).
// Ini fix masalah CSRF Django karena request datang dari http://localhost langsung,
// bukan dari iframe di dalam file:// protocol.
let labelStudioWindow = null;
ipcMain.handle('annotation:openWindow', async (_, opts = {}) => {
    // Auto-detect base URL
    let base = 'http://localhost:8080';
    try {
        base = (await labelstudio.getBase()).replace('/api', '');
    } catch (_) {}

    // Target URL: kalau ada projectId, langsung ke halaman labeling project
    // Kalau nggak, ke home (tapi umumnya dipanggil dengan projectId)
    let url = base;
    if (opts.projectId) {
        // /projects/{id}/data → data manager task list dengan tombol Label
        // /projects/{id}/labelstream → langsung mode labeling task pertama
        url = `${base}/projects/${opts.projectId}/data`;
    } else if (opts.path) {
        url = base + opts.path;
    }

    if (labelStudioWindow && !labelStudioWindow.isDestroyed()) {
        labelStudioWindow.focus();
        await labelStudioWindow.loadURL(url);
        return { opened: true, reused: true, url };
    }
    labelStudioWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: 'Label Studio — AutomaEyes Annotation',
        parent: mainWindow,
        modal: false,
        backgroundColor: '#ffffff',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:labelstudio',
        },
    });
    labelStudioWindow.setMenuBarVisibility(false);

    // Intercept link/window.open() dari Label Studio supaya tidak buka
    // external browser — load di window yang sama.
    labelStudioWindow.webContents.setWindowOpenHandler(({ url: navUrl }) => {
        console.log(`[LS window] intercept window.open: ${navUrl}`);
        // Kalau localhost, load di window sama
        if (navUrl.includes('localhost') || navUrl.includes('127.0.0.1')) {
            labelStudioWindow.loadURL(navUrl);
        } else {
            // External URL (docs, github, dll) → shell.openExternal
            shell.openExternal(navUrl);
        }
        return { action: 'deny' };
    });

    // Intercept navigate ke external domain juga
    labelStudioWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (!navUrl.includes('localhost') && !navUrl.includes('127.0.0.1')) {
            event.preventDefault();
            shell.openExternal(navUrl);
        }
    });

    await labelStudioWindow.loadURL(url);
    labelStudioWindow.on('closed', () => { labelStudioWindow = null; });
    return { opened: true, reused: false, url };
});

// Buka folder di file explorer
ipcMain.handle('dataset:openFolder', async (_, { project, model }) => {
    const datasetDir = projects.datasetPath(projectsRoot, project, model);
    return shell.openPath(datasetDir);
});

// Cek apakah tool anotasi tersedia (untuk tombol "Cek Instalasi")
ipcMain.handle('annotation:check', async () => {
    const { exec } = require('child_process');
    const cmd = cfg.annotation.command || 'anylabeling';
    const parts = cmd.split(/\s+/);
    const first = parts[0];

    return new Promise((resolve) => {
        // Kalau bentuknya `python -m foo.bar`, cek import module foo.bar
        if (parts.length >= 3 && parts[1] === '-m') {
            const moduleName = parts[2]; // mis. "anylabeling.app"
            // Test: import <module>. Kalau ini package tanpa __main__,
            // tetap sukses import — user perlu tahu bahwa module bisa di-load.
            exec(`${first} -c "import ${moduleName}"`, (err) => {
                if (err) {
                    resolve({ available: false, command: cmd, error: err.message });
                } else {
                    resolve({
                        available: true, command: cmd,
                        resolvedPath: `${first} -m ${moduleName} (module importable)`,
                    });
                }
            });
            return;
        }

        // Bukan python -m: cek pakai where/which
        const checker = process.platform === 'win32' ? 'where' : 'which';
        exec(`${checker} ${first}`, (err, stdout) => {
            if (err || !stdout.trim()) {
                resolve({ available: false, command: cmd, error: 'command not in PATH' });
            } else {
                resolve({
                    available: true, command: cmd,
                    resolvedPath: stdout.trim().split('\n')[0],
                });
            }
        });
    });
});

// ---- Training ----
ipcMain.handle('training:start', async (event, { project, model, resume }) => {
    return inference.startTraining(cfg, projectsRoot, project, model, (progress) => {
        event.sender.send('training:progress', { project, model, progress });
    }, { resume: !!resume });
});
ipcMain.handle('training:cancel', () => inference.cancelTraining());
ipcMain.handle('training:loadHistory', (_e, { project, model }) =>
    inference.loadTrainHistory(projectsRoot, project, model));

// ---- Sinkronisasi GitHub (Save/Load) ----
ipcMain.handle('git:status', () => gitsync.status(APP_ROOT));
ipcMain.handle('git:push', (_e, { message } = {}) => gitsync.push(APP_ROOT, message));
ipcMain.handle('git:pull', () => gitsync.pull(APP_ROOT));
ipcMain.handle('app:quit', () => { app.quit(); });
// Auto-load versi terbaru sekali saja saat app pertama dibuka.
ipcMain.handle('git:autoPullOnce', async () => {
    if (_autoPullDone) return { skipped: true, result: _autoPullResult };
    _autoPullDone = true;
    try {
        _autoPullResult = await gitsync.pull(APP_ROOT);
    } catch (e) {
        _autoPullResult = { ok: false, log: String(e && e.message || e) };
    }
    return { skipped: false, result: _autoPullResult };
});

// ---- Evaluasi / Test model ----
ipcMain.handle('eval:run', async (event, { project, model, split }) =>
    inference.evaluate(cfg, projectsRoot, project, model, split, (p) =>
        event.sender.send('eval:progress', { project, model, ...p })));
ipcMain.handle('eval:openDir', (_, { dir }) => shell.openPath(dir));

// ---- Workflow ----
ipcMain.handle('workflow:save', (_, { project, steps, onFirstNG }) =>
    projects.saveWorkflow(projectsRoot, project, steps, onFirstNG));

// ---- Run / Inference ----
ipcMain.handle('run:inspect', async (_, { project, imageDataUrl, opts }) => {
    // imageDataUrl = "data:image/jpeg;base64,..."
    const proj = projects.load(projectsRoot, project);
    return workflow.execute(cfg, proj, imageDataUrl, arduino, output, opts || {});
});

// ---- Auto-Calibration ----
ipcMain.handle('calibration:run', async (event, { project, model }) => {
    if (!cfg.auto_calibration || !cfg.auto_calibration.enabled) {
        throw new Error('Auto-Calibration belum diaktifkan. Buka Settings → aktifkan.');
    }
    const proj = projects.load(projectsRoot, project);
    const m = proj.models.find(x => x.name === model);
    if (!m) throw new Error('Model tidak ditemukan: ' + model);
    const res = await calibration.calibrate(cfg, m.dir, m.classes, (p) => {
        event.sender.send('calibration:progress', { project, model, ...p });
    });
    // Terapkan hasil kalibrasi ke config & simpan.
    cfg.model = { ...cfg.model, confidence: res.bestConf };
    saveConfig();
    return res;
});

// ---- Self-Learning ----
ipcMain.handle('selflearning:status', (_, { project, model }) => {
    const proj = projects.load(projectsRoot, project);
    return selflearning.status(proj, model, cfg);
});
ipcMain.handle('selflearning:archive', (_, { project, model }) => {
    const proj = projects.load(projectsRoot, project);
    return selflearning.archive(proj, model);
});

// ---- NVIDIA NIM ----
ipcMain.handle('nvidia:report', async (_, { project, date }) => {
    const r = await nvidia.generateReport(cfg, projectsRoot, project, date);
    // Tulis juga ke XLSX (statistik + ringkasan AI) di outputs/ project.
    try {
        const xlsxlite = require('./lib/xlsxlite');
        const p = projects.load(projectsRoot, project);
        const s = r.summary || {};
        const outDir = path.join(p.dir, 'outputs');
        fs.mkdirSync(outDir, { recursive: true });
        const xlsxPath = path.join(outDir, `laporan_${date}.xlsx`);
        const rows = [
            [`Laporan Inspeksi — ${project}`],
            ['Tanggal', date],
            [],
            ['Metrik', 'Nilai'],
            ['Total unit', s.total || 0],
            ['OK', s.ok || 0],
            ['NG', s.ng || 0],
            ['Success rate (%)', s.total ? Number((s.ok / s.total * 100).toFixed(2)) : 0],
            ['Waktu siklus rata-rata (ms)', Number((s.avgCycleMS || 0).toFixed(1))],
            [],
            ['NG per step', 'Jumlah'],
            ...Object.entries(s.byStep || {}).map(([k, v]) => [k, v]),
            [],
            ['Ringkasan AI (NVIDIA NIM)', ''],
            ...String(r.report || '').split(/\r?\n/).map(line => [line]),
        ];
        xlsxlite.write(xlsxPath, 'Laporan', rows);
        r.xlsxPath = xlsxPath;
    } catch (e) {
        r.xlsxError = e.message;
    }
    return r;
});
ipcMain.handle('file:open', (_, p) => shell.openPath(p));
ipcMain.handle('nvidia:analyze', (_, { project, date }) =>
    nvidia.analyzeNG(cfg, projectsRoot, project, date));
ipcMain.handle('nvidia:chat', (_, { messages }) =>
    nvidia.chat(cfg, messages));

// ---- Navigation ----
ipcMain.handle('nav:go', (_, page) => {
    // page bisa berisi query string, contoh: "project.html?name=Foo"
    const [filePart, queryPart] = String(page).split('?');
    const target = path.join(__dirname, 'renderer/pages', filePart);
    if (!fs.existsSync(target)) {
        console.warn(`[nav:go] File tidak ada: ${target}`);
        return { ok: false, error: 'file not found' };
    }
    const opts = {};
    if (queryPart) {
        const params = new URLSearchParams(queryPart);
        const query = {};
        for (const [k, v] of params) query[k] = v;
        opts.query = query;
    }
    mainWindow.loadFile(target, opts);
    return { ok: true };
});
