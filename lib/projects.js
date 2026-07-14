// Project + Model domain — CRUD, JSON persistence, dataset ops.
//
// Layout folder tiap project:
//   projects/
//     <name>/
//       project.json
//       models/
//         <model>/
//           model.json
//           dataset/
//             images/{train,val}/
//             labels/{train,val}/
//             data.yaml
//           weights/
//           runs/
//       outputs/
//         YYYY-MM-DD/NNN-HHMM.jpg + .json
//         daily_summary.csv

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_FILE = 'project.json';
const MODELS_DIR = 'models';
const OUTPUTS_DIR = 'outputs';
const DATASET_DIR = 'dataset';
const WEIGHTS_DIR = 'weights';

const AI_TYPES = [
    'AI Segmentation', 'AI Detection', 'AI Classification', 'AI OCR',
];
const ADDONS = [
    'Presence Check', 'Scratches', 'GD&T Measurement', 'Positioning',
    'Color Inspection', 'Count', 'Character Recognition',
    '1D Code', '2D Code', 'Calibration',
];
const CATEGORIES = [
    'Capture', 'Positioning', 'Inspection', 'Communication', 'Options',
];

exports.AI_TYPES = AI_TYPES;
exports.ADDONS = ADDONS;
exports.CATEGORIES = CATEGORIES;

// --- helpers ---
function sanitize(s) {
    return String(s).trim().replace(/[\/\\:*?"<>|]/g, '_');
}
function projectDir(root, name) { return path.join(root, name); }
function modelDir(root, projectName, modelName) {
    return path.join(root, projectName, MODELS_DIR, modelName);
}
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// --- Project CRUD ---
exports.list = (root) => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            try { return loadProject(root, d.name); }
            catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};

function loadProject(root, name) {
    const f = path.join(root, name, PROJECT_FILE);
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    data.dir = path.join(root, name);
    // Inject model dirs
    for (const m of data.models || []) {
        m.dir = modelDir(root, name, m.name);
    }
    return data;
}

function saveProject(root, p) {
    p.updatedAt = new Date().toISOString();
    const dir = projectDir(root, p.name);
    ensureDir(dir);
    const toSave = { ...p };
    delete toSave.dir;
    toSave.models = (p.models || []).map(m => { const c = { ...m }; delete c.dir; return c; });
    fs.writeFileSync(path.join(dir, PROJECT_FILE), JSON.stringify(toSave, null, 2));
}

exports.load = loadProject;

// --- Model versioning (ala Roboflow: tiap training menghasilkan versi baru) ---
// Snapshot weights/best.pt saat ini → versions/v<N>/best.pt + catat di project.json.
exports.snapshotVersion = (root, projectName, modelName, metrics) => {
    const p = loadProject(root, projectName);
    const m = (p.models || []).find(x => x.name === modelName);
    if (!m) throw new Error('Model tidak ada: ' + modelName);
    const mDir = modelDir(root, projectName, modelName);
    const src = path.join(mDir, 'weights', 'best.pt');
    if (!fs.existsSync(src)) throw new Error('weights/best.pt tidak ada');
    const id = (m.versions && m.versions.length) ? Math.max(...m.versions.map(v => v.id)) + 1 : 1;
    const vdir = path.join(mDir, 'versions', 'v' + id);
    ensureDir(vdir);
    fs.copyFileSync(src, path.join(vdir, 'best.pt'));
    m.versions = m.versions || [];
    m.versions.push({ id, date: new Date().toISOString(), metrics: metrics || {}, classes: (m.classes || []).slice() });
    m.activeVersion = id;
    saveProject(root, p);
    return { id, versions: m.versions, activeVersion: id };
};

// Set versi aktif (default dipakai kalau workflow tak menentukan versi).
exports.setActiveVersion = (root, projectName, modelName, versionId) => {
    const p = loadProject(root, projectName);
    const m = (p.models || []).find(x => x.name === modelName);
    if (!m) throw new Error('Model tidak ada');
    const vId = Number(versionId);
    // Salin weights versi ini ke weights/best.pt supaya jadi default aktif.
    const mDir = modelDir(root, projectName, modelName);
    const vw = path.join(mDir, 'versions', 'v' + vId, 'best.pt');
    if (fs.existsSync(vw)) fs.copyFileSync(vw, path.join(mDir, 'weights', 'best.pt'));
    m.activeVersion = vId;
    saveProject(root, p);
    return { activeVersion: vId };
};

// Resolusi path weights: versi tertentu → aktif → weights/best.pt (legacy).
exports.resolveWeights = (root, projectName, modelName, versionId) => {
    const mDir = modelDir(root, projectName, modelName);
    const tryV = (id) => {
        if (!id) return null;
        const w = path.join(mDir, 'versions', 'v' + id, 'best.pt');
        return fs.existsSync(w) ? w : null;
    };
    let w = tryV(versionId);
    if (!w) {
        try {
            const p = loadProject(root, projectName);
            const m = (p.models || []).find(x => x.name === modelName);
            w = tryV(m && m.activeVersion);
        } catch (_) { }
    }
    return w || path.join(mDir, 'weights', 'best.pt');
};

exports.create = (root, name, description) => {
    name = sanitize(name);
    if (!name) throw new Error('Nama project kosong');
    const dir = projectDir(root, name);
    if (fs.existsSync(dir)) throw new Error(`Project "${name}" sudah ada`);
    ensureDir(dir);
    ensureDir(path.join(dir, MODELS_DIR));
    ensureDir(path.join(dir, OUTPUTS_DIR));
    const now = new Date().toISOString();
    const p = {
        name, description: description || '',
        createdAt: now, updatedAt: now,
        models: [],
        workflow: { steps: [], onFirstNG: 'stop_and_report' },
    };
    saveProject(root, p);
    return loadProject(root, name);
};

exports.delete = (root, name) => {
    const dir = projectDir(root, name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
};

// --- Model CRUD ---
exports.addModel = (root, projectName, { name, aiType, addons, classes, addonConfig }) => {
    const p = loadProject(root, projectName);
    name = sanitize(name);
    if (!name) throw new Error('Nama model kosong');
    if (p.models.find(m => m.name === name)) throw new Error(`Model "${name}" sudah ada`);
    if (!AI_TYPES.includes(aiType)) throw new Error(`AI type "${aiType}" invalid`);
    if (!Array.isArray(classes) || classes.length === 0) throw new Error('Kelas minimal 1');

    const mDir = modelDir(root, projectName, name);
    for (const sub of [
        path.join(DATASET_DIR, 'images/train'),
        path.join(DATASET_DIR, 'images/val'),
        path.join(DATASET_DIR, 'labels/train'),
        path.join(DATASET_DIR, 'labels/val'),
        WEIGHTS_DIR, 'runs',
    ]) ensureDir(path.join(mDir, sub));

    // Write data.yaml for Ultralytics YOLO
    const dataYaml = [
        `# Auto-generated by AutomaEyes (Electron)`,
        `path: ${path.join(mDir, DATASET_DIR).replace(/\\/g, '/')}`,
        `train: images/train`,
        `val: images/val`,
        ``,
        `nc: ${classes.length}`,
        `names:`,
        ...classes.map(c => `  - ${c}`),
    ].join('\n');
    fs.writeFileSync(path.join(mDir, DATASET_DIR, 'data.yaml'), dataYaml);

    const now = new Date().toISOString();
    const m = {
        name, type: aiType,
        addons: addons || [],
        addonConfig: addonConfig || {},
        classes,
        training: {
            epochs: 100, batch: 16, imgsz: 640, lr: 0.01,
            augRotate: true, augFlip: true, augBlur: false, augExposure: true, augNoise: false,
        },
        trained: false,
        createdAt: now, updatedAt: now,
        lastMAP: 0, lastPrecision: 0, lastRecall: 0, lastF1: 0,
    };
    p.models.push(m);
    saveProject(root, p);
    m.dir = mDir;
    return m;
};

exports.updateModel = (root, projectName, modelName, patch) => {
    const p = loadProject(root, projectName);
    const m = p.models.find(x => x.name === modelName);
    if (!m) throw new Error('Model not found');
    Object.assign(m, patch);
    m.updatedAt = new Date().toISOString();
    saveProject(root, p);
    return m;
};

exports.deleteModel = (root, projectName, modelName) => {
    const p = loadProject(root, projectName);
    const idx = p.models.findIndex(x => x.name === modelName);
    if (idx < 0) throw new Error('Model not found');
    const mDir = modelDir(root, projectName, modelName);
    if (fs.existsSync(mDir)) fs.rmSync(mDir, { recursive: true, force: true });
    p.models.splice(idx, 1);
    // Lepas step Workflow yang memakai model ini supaya tidak jadi referensi menggantung.
    if (p.workflow && Array.isArray(p.workflow.steps)) {
        p.workflow.steps = p.workflow.steps.filter(s => s.modelName !== modelName);
        p.workflow.steps.forEach((s, i) => s.stepIndex = i + 1);
    }
    saveProject(root, p);
    return { ok: true };
};

// --- Dataset ---
exports.listImages = (root, projectName, modelName, split) => {
    const dir = path.join(modelDir(root, projectName, modelName), DATASET_DIR, 'images', split);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
        .map(f => ({ name: f, path: path.join(dir, f) }));
};

// List gambar sebuah split + parse bounding box dari label YOLO-nya.
// Dipakai gallery preview untuk menggambar anotasi di atas thumbnail.
exports.listImagesWithLabels = (root, projectName, modelName, split) => {
    const dsDir = path.join(modelDir(root, projectName, modelName), DATASET_DIR);
    const imgDir = path.join(dsDir, 'images', split);
    const lblDir = path.join(dsDir, 'labels', split);
    if (!fs.existsSync(imgDir)) return [];
    return fs.readdirSync(imgDir)
        .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
        .map(f => {
            const stem = path.parse(f).name;
            const lblPath = path.join(lblDir, stem + '.txt');
            let boxes = [];
            if (fs.existsSync(lblPath)) {
                boxes = fs.readFileSync(lblPath, 'utf8').split(/\r?\n/).map(line => {
                    const p = line.trim().split(/\s+/);
                    if (p.length < 5) return null;
                    const cls = parseInt(p[0], 10);
                    const vals = p.slice(1).map(Number);
                    if (vals.some(v => Number.isNaN(v))) return null;
                    if (vals.length === 4) {                       // bbox (deteksi)
                        const [cx, cy, w, h] = vals;
                        return { cls, cx, cy, w, h };
                    }
                    if (vals.length >= 6 && vals.length % 2 === 0) { // poligon (segmentasi)
                        const xs = [], ys = [];
                        for (let i = 0; i < vals.length; i += 2) { xs.push(vals[i]); ys.push(vals[i + 1]); }
                        const minx = Math.min(...xs), maxx = Math.max(...xs);
                        const miny = Math.min(...ys), maxy = Math.max(...ys);
                        return { cls, poly: vals, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w: maxx - minx, h: maxy - miny };
                    }
                    return null;
                }).filter(Boolean);
            }
            return { name: f, path: path.join(imgDir, f), isAug: f.includes('.aug'), boxes };
        });
};

exports.importImages = (root, projectName, modelName, filePaths) => {
    const dstDir = path.join(modelDir(root, projectName, modelName), DATASET_DIR, 'images', 'train');
    ensureDir(dstDir);
    let saved = 0;
    for (const src of filePaths) {
        try {
            const base = path.basename(src);
            fs.copyFileSync(src, path.join(dstDir, base));
            saved++;
        } catch (e) { console.error('copy failed', src, e.message); }
    }
    return { saved };
};

// Hapus gambar (beserta label YOLO-nya) dari SEMUA split. names = daftar basename.
exports.deleteDatasetImages = (root, projectName, modelName, names) => {
    const dsDir = path.join(modelDir(root, projectName, modelName), DATASET_DIR);
    const splits = ['train', 'val', 'test'];
    let deleted = 0;
    for (const name of (names || [])) {
        const base = path.basename(String(name)); // cegah path traversal
        const stem = path.parse(base).name;
        for (const sp of splits) {
            const img = path.join(dsDir, 'images', sp, base);
            const lbl = path.join(dsDir, 'labels', sp, stem + '.txt');
            try { if (fs.existsSync(img)) { fs.unlinkSync(img); deleted++; } } catch (e) { console.error('del img', e.message); }
            try { if (fs.existsSync(lbl)) fs.unlinkSync(lbl); } catch (e) { console.error('del lbl', e.message); }
        }
    }
    return { deleted };
};

// Import existing .pt file → copy ke weights/best.pt, mark trained
exports.importPt = (root, projectName, modelName, srcPath) => {
    const p = loadProject(root, projectName);
    const m = p.models.find(x => x.name === modelName);
    if (!m) throw new Error('Model not found');
    if (!fs.existsSync(srcPath)) throw new Error('File .pt tidak ada: ' + srcPath);
    if (!srcPath.toLowerCase().endsWith('.pt')) {
        throw new Error('Hanya file .pt yang di-support');
    }

    const mDir = modelDir(root, projectName, modelName);
    ensureDir(path.join(mDir, WEIGHTS_DIR));
    const dst = path.join(mDir, WEIGHTS_DIR, 'best.pt');
    fs.copyFileSync(srcPath, dst);

    // Mark model as trained. mAP dsb kita nggak tahu, biarkan 0 (user bisa isi manual)
    m.trained = true;
    m.updatedAt = new Date().toISOString();
    // Kalau belum ada metrics, set placeholder
    if (!m.lastMAP) {
        m.lastMAP = 0;
        m.lastPrecision = 0;
        m.lastRecall = 0;
        m.lastF1 = 0;
    }
    saveProject(root, p);
    return { imported: true, dst, sizeBytes: fs.statSync(dst).size };
};

exports.modelStats = (root, projectName, modelName) => {
    const mDir = modelDir(root, projectName, modelName);
    const count = (p, exts) => {
        if (!fs.existsSync(p)) return 0;
        return fs.readdirSync(p).filter(f => exts.some(e => f.toLowerCase().endsWith(e))).length;
    };
    return {
        train: count(path.join(mDir, DATASET_DIR, 'images/train'), ['.jpg', '.png', '.jpeg']),
        val: count(path.join(mDir, DATASET_DIR, 'images/val'), ['.jpg', '.png', '.jpeg']),
        test: count(path.join(mDir, DATASET_DIR, 'images/test'), ['.jpg', '.png', '.jpeg']),
        annotated: count(path.join(mDir, DATASET_DIR, 'labels/train'), ['.txt']),
    };
};

// ================= Dataset split & clean-rebuild =================
const IMG_RE = /\.(jpg|jpeg|png)$/i;

// List file gambar di sebuah folder. augOnly: true=hanya aug, false=hanya asli, null=semua.
function listImages(dir, augOnly = null) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => {
        if (!IMG_RE.test(f)) return false;
        const isAug = f.includes('.aug');
        if (augOnly === true) return isAug;
        if (augOnly === false) return !isAug;
        return true;
    });
}

function moveAllFiles(srcDir, dstDir) {
    if (!fs.existsSync(srcDir)) return;
    ensureDir(dstDir);
    for (const f of fs.readdirSync(srcDir)) {
        const s = path.join(srcDir, f);
        if (fs.statSync(s).isFile()) fs.renameSync(s, path.join(dstDir, f));
    }
}

// PRNG seed tetap (mulberry32) → split reproducible tiap kali.
function seededShuffle(arr, seed) {
    let t = seed >>> 0;
    const rnd = () => {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Tulis ulang data.yaml. val jatuh ke images/train kalau val kosong (YOLO wajib val).
function writeDataYaml(root, projectName, modelName) {
    const mDir = modelDir(root, projectName, modelName);
    const dsDir = path.join(mDir, DATASET_DIR);
    const p = loadProject(root, projectName);
    const m = (p.models || []).find(x => x.name === modelName);
    const classes = (m && Array.isArray(m.classes) && m.classes.length) ? m.classes : ['object'];
    const hasImgs = sub => listImages(path.join(dsDir, 'images', sub)).length > 0;
    const hasVal = hasImgs('val');
    const hasTest = hasImgs('test');
    const lines = [
        `# Auto-generated by AutomaEyes (Electron)`,
        `path: ${dsDir.replace(/\\/g, '/')}`,
        `train: images/train`,
        `val: images/${hasVal ? 'val' : 'train'}`,
    ];
    if (hasTest) lines.push(`test: images/test`);
    lines.push('', `nc: ${classes.length}`, `names:`, ...classes.map(c => `  - ${c}`));
    fs.writeFileSync(path.join(dsDir, 'data.yaml'), lines.join('\n'));
    return { hasVal, hasTest };
}

// Hapus semua file augmentasi (*.aug*) dari semua split. Return jumlah gambar dihapus.
function deleteAugmented(dsDir) {
    let removed = 0;
    for (const sub of ['train', 'val', 'test']) {
        for (const kind of ['images', 'labels']) {
            const d = path.join(dsDir, kind, sub);
            if (!fs.existsSync(d)) continue;
            for (const f of fs.readdirSync(d)) {
                if (f.includes('.aug')) {
                    fs.unlinkSync(path.join(d, f));
                    if (kind === 'images') removed++;
                }
            }
        }
    }
    return removed;
}

// Rename label yang namanya tidak match gambar (mis. prefix hash Label Studio)
// jadi cocok dengan stem gambar. Return jumlah yang diperbaiki.
function fixLabelNames(dsDir) {
    let fixed = 0;
    for (const sub of ['train', 'val', 'test']) {
        const imgD = path.join(dsDir, 'images', sub);
        const lblD = path.join(dsDir, 'labels', sub);
        if (!fs.existsSync(lblD) || !fs.existsSync(imgD)) continue;
        const stems = new Set(listImages(imgD).map(f => path.parse(f).name));
        for (const f of fs.readdirSync(lblD)) {
            if (!f.toLowerCase().endsWith('.txt')) continue;
            const stem = f.replace(/\.txt$/i, '');
            if (stems.has(stem)) continue;
            let target = stem.replace(/^[0-9a-fA-F]{6,}-/, '');
            if (!stems.has(target)) {
                const hit = [...stems].find(s => stem.endsWith('-' + s) || stem.endsWith('_' + s));
                if (hit) target = hit;
            }
            if (stems.has(target)) {
                const src = path.join(lblD, f);
                const dst = path.join(lblD, target + '.txt');
                if (src !== dst) { fs.renameSync(src, dst); fixed++; }
            }
        }
    }
    return fixed;
}

// Split gambar ASLI ber-label menjadi train/val/test. Augmented (*.aug*) selalu
// tinggal di train. Idempotent: val/test dikonsolidasi ke train dulu tiap dipanggil.
exports.splitDataset = (root, projectName, modelName, ratios = {}) => {
    const mDir = modelDir(root, projectName, modelName);
    const dsDir = path.join(mDir, DATASET_DIR);
    const rVal = ratios.val != null ? ratios.val : 0.2;
    const rTest = ratios.test != null ? ratios.test : 0.1;

    for (const sub of ['train', 'val', 'test'])
        for (const kind of ['images', 'labels']) ensureDir(path.join(dsDir, kind, sub));

    // 1. Konsolidasi val/test kembali ke train (biar re-split idempotent)
    for (const sub of ['val', 'test']) {
        moveAllFiles(path.join(dsDir, 'images', sub), path.join(dsDir, 'images', 'train'));
        moveAllFiles(path.join(dsDir, 'labels', sub), path.join(dsDir, 'labels', 'train'));
    }

    const imgTrain = path.join(dsDir, 'images', 'train');
    const lblTrain = path.join(dsDir, 'labels', 'train');

    // 2. Pool = gambar asli (non-aug) yang punya label
    const pool = listImages(imgTrain, false).filter(f =>
        fs.existsSync(path.join(lblTrain, path.parse(f).name + '.txt')));
    seededShuffle(pool, 1337);

    const n = pool.length;
    let nVal = Math.round(n * rVal);
    let nTest = Math.round(n * rTest);
    if (n >= 3 && nVal === 0) nVal = 1;               // pastikan val >=1 kalau memungkinkan
    if (nVal + nTest > n - 1) nTest = Math.max(0, n - nVal - 1); // sisakan >=1 utk train

    const valSet = pool.slice(0, nVal);
    const testSet = pool.slice(nVal, nVal + nTest);

    const moveOne = (file, destSub) => {
        const stem = path.parse(file).name;
        fs.renameSync(path.join(imgTrain, file), path.join(dsDir, 'images', destSub, file));
        const lblSrc = path.join(lblTrain, stem + '.txt');
        if (fs.existsSync(lblSrc))
            fs.renameSync(lblSrc, path.join(dsDir, 'labels', destSub, stem + '.txt'));
    };
    valSet.forEach(f => moveOne(f, 'val'));
    testSet.forEach(f => moveOne(f, 'test'));

    // 3. Cegah data leakage: kalau user augmentasi DULU baru split, gambar augmentasi
    // dari original yang masuk val/test masih nyangkut di train. Itu bikin model
    // "mengintip" data evaluasi. Buang augmentasi yang sumbernya ada di val/test.
    const heldOutStems = new Set([...valSet, ...testSet].map(f => path.parse(f).name));
    const AUG_SUFFIX = /\.(rotate|fliph|flipv|blur|exposure|noise)\.aug\d+$/i;
    let leakRemoved = 0;
    for (const f of listImages(imgTrain, true)) {          // hanya file *.aug*
        const src = path.parse(f).name.replace(AUG_SUFFIX, '');
        if (heldOutStems.has(src)) {
            fs.unlinkSync(path.join(imgTrain, f));
            const lbl = path.join(lblTrain, path.parse(f).name + '.txt');
            if (fs.existsSync(lbl)) fs.unlinkSync(lbl);
            leakRemoved++;
        }
    }

    const yaml = writeDataYaml(root, projectName, modelName);
    return {
        originals: n,
        train: listImages(imgTrain).length,
        val: valSet.length,
        test: testSet.length,
        leakRemoved,
        ...yaml,
    };
};

// Buang gambar ASLI (non-aug) yang tidak punya label — mis. gambar yang di-skip
// saat anotasi tapi filenya masih ada di dataset. Return jumlah yang dibuang.
function deleteUnlabeledOriginals(dsDir) {
    let removed = 0;
    for (const sub of ['train', 'val', 'test']) {
        const imgD = path.join(dsDir, 'images', sub);
        const lblD = path.join(dsDir, 'labels', sub);
        if (!fs.existsSync(imgD)) continue;
        for (const f of listImages(imgD, false)) {   // hanya gambar asli (non-aug)
            const lbl = path.join(lblD, path.parse(f).name + '.txt');
            if (!fs.existsSync(lbl)) { fs.unlinkSync(path.join(imgD, f)); removed++; }
        }
    }
    return removed;
}

// Bersihkan dataset lalu split ulang: buang augmented, betulkan nama label,
// buang gambar asli tanpa label, baru split. Untuk dataset yang terlanjur rusak
// atau berisi gambar kosong (di-skip saat anotasi).
exports.cleanRebuildDataset = (root, projectName, modelName, ratios) => {
    const mDir = modelDir(root, projectName, modelName);
    const dsDir = path.join(mDir, DATASET_DIR);
    const removedAug = deleteAugmented(dsDir);
    const fixedNames = fixLabelNames(dsDir);
    const removedEmpty = deleteUnlabeledOriginals(dsDir);
    const split = exports.splitDataset(root, projectName, modelName, ratios);
    return { removedAug, fixedNames, removedEmpty, ...split };
};

// --- Augmentation via Python subprocess ---
exports.augmentDataset = (root, projectName, modelName, opts, pyCfg, onProgress) => {
    return new Promise((resolve, reject) => {
        const mDir = modelDir(root, projectName, modelName);
        // splits: default hanya 'train'. Bisa ['train','val','test'] kalau diminta
        // (mis. syarat pembimbing). Tiap split di-augment ke foldernya sendiri.
        const splits = Array.isArray(opts.splits) && opts.splits.length
            ? opts.splits.filter(s => ['train', 'val', 'test'].includes(s))
            : ['train'];
        const args = ['python/augment.py',
            '--dir', path.join(mDir, DATASET_DIR),
            '--multiplier', String(opts.multiplier || 2),
            '--splits', splits.join(','),
        ];
        if (opts.rotate) {
            args.push('--rotate', '--rotate-max', String(opts.rotateMax || 15));
        }
        if (opts.flipH) args.push('--flip-h');
        if (opts.flipV) args.push('--flip-v');
        if (opts.blur) {
            args.push('--blur', '--blur-sigma', String(opts.blurSigma || 2.0));
        }
        if (opts.exposure) {
            args.push('--exposure', '--exposure-alpha', String(opts.exposureAlpha || 1.2));
        }
        if (opts.noise) {
            args.push('--noise', '--noise-sigma', String(opts.noiseSigma || 8));
        }

        const py = spawn(pyCfg.exe || 'python', args);
        let stdout = '', stderr = '';
        py.stdout.on('data', d => {
            const s = d.toString();
            stdout += s;
            // Stream progress "PROGRESS done/total" ke UI
            s.split(/\r?\n/).forEach(line => {
                const pm = line.match(/PROGRESS (\d+)\/(\d+)/);
                if (pm && onProgress) onProgress({ done: +pm[1], total: +pm[2] });
            });
        });
        py.stderr.on('data', d => stderr += d);
        py.on('close', code => {
            if (code !== 0) return reject(new Error(`augment gagal: ${stderr || stdout}`));
            const match = stdout.match(/generated: (\d+)/);
            resolve({ generated: match ? parseInt(match[1]) : 0, log: stdout });
        });
    });
};

exports.datasetPath = (root, projectName, modelName) =>
    path.join(modelDir(root, projectName, modelName), DATASET_DIR);

// ---- Label Studio embedded server ----
//
// Approach: Label Studio dijalankan sebagai server background (port 8080).
// UI-nya di-embed di window Electron via <iframe>, jadi user nggak perlu
// buka browser terpisah — semua di dalam AutomaEyes.
let labelStudioProc = null;

// Cara-cara alternatif start Label Studio, coba urut sampai ada yang jalan.
// Wrapper `python python/run_label_studio.py start` diutamakan karena include
// compatibility shim untuk Python 3.14 (pkgutil.find_loader dihapus).
const LS_CANDIDATES = [
    'python python/run_label_studio.py start',
    'python -m label_studio.server start',
    'python -m label_studio start',
    'label-studio start',
    'labelstudio start',
];

// Label Studio dipasang di virtual-env terpisah (python/ls-venv) supaya
// dependency-nya tidak bentrok dengan ultralytics. Kalau venv ada, pakai duluan.
const LS_VENV_PY = process.platform === 'win32'
    ? path.join(__dirname, '..', 'python', 'ls-venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', 'python', 'ls-venv', 'bin', 'python');
const LS_RUNNER = path.join(__dirname, '..', 'python', 'run_label_studio.py');

exports.startLabelStudioServer = async (annCfg) => {
    if (labelStudioProc) {
        return { alreadyRunning: true, port: 8080, pid: labelStudioProc.pid };
    }

    const userCmd = annCfg.command;
    const candidates = [];
    // Prioritas 1: venv khusus Label Studio (kalau sudah di-setup).
    if (fs.existsSync(LS_VENV_PY)) candidates.push([LS_VENV_PY, LS_RUNNER, 'start']);
    if (userCmd) candidates.push(userCmd);
    for (const c of LS_CANDIDATES) if (c !== userCmd) candidates.push(c);

    for (const cmd of candidates) {
        const res = await tryStart(cmd);
        if (res.started) return { ...res, usedCommand: cmd };
        // Kalau error karena command tidak ada, coba next candidate.
        // Kalau error karena reason lain (port occupied dll), berhenti.
        if (res.error && !/not recognized|not found|ENOENT|is not recognized/i.test(res.error)) {
            return { ...res, triedCommand: cmd };
        }
    }
    return {
        started: false,
        error: 'Semua cara start Label Studio gagal. Pastikan sudah `pip install label-studio`',
        tried: candidates,
    };
};

function tryStart(cmdString) {
    return new Promise((resolve) => {
        // cmdString bisa string ("python ... start") atau array (["C:/.../python.exe", ...]).
        // Array dipakai untuk path absolut (venv) yang mungkin mengandung spasi.
        const isArr = Array.isArray(cmdString);
        const parts = isArr ? cmdString : cmdString.split(/\s+/);
        let child;
        try {
            child = spawn(parts[0], parts.slice(1), {
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: isArr ? false : (process.platform === 'win32'),
                env: {
                    ...process.env,
                    LABEL_STUDIO_PORT: '8080',
                    LABEL_STUDIO_HOST: '0.0.0.0',
                    // Trust semua origin lokal supaya CSRF nggak reject form.
                    CSRF_TRUSTED_ORIGINS:
                        'http://localhost:8080,http://127.0.0.1:8080,http://0.0.0.0:8080',
                    DJANGO_ALLOWED_HOSTS: '*',
                    LABEL_STUDIO_DISABLE_SIGNUP_WITHOUT_LINK: 'false',
                    OPT_OUT_ANALYTICS: 'true',
                    // JANGAN auto-open browser saat server start (default Django).
                    LABEL_STUDIO_NO_BROWSER: 'true',
                    BROWSER: 'none',
                },
            });
        } catch (e) {
            return resolve({ started: false, error: e.message });
        }

        let done = false;
        let stdoutBuf = '';
        const finish = (result) => { if (!done) { done = true; resolve(result); } };

        child.stdout?.on('data', d => {
            stdoutBuf += d.toString();
            if (/Django version|Starting development server|Listening on|http:\/\/0\.0\.0\.0/.test(stdoutBuf)) {
                labelStudioProc = child;
                finish({ started: true, port: 8080, pid: child.pid });
            }
        });
        child.stderr?.on('data', d => { stdoutBuf += d.toString(); });
        child.on('error', (err) => finish({ started: false, error: err.message }));
        child.on('exit', (code) => {
            if (!done) {
                finish({
                    started: false,
                    error: `exit ${code}: ${stdoutBuf.slice(-500) || 'no output'}`,
                });
            }
        });

        // Kalau tidak ada indicator 25 detik tapi tidak error, assume running
        setTimeout(() => {
            if (!done) {
                labelStudioProc = child;
                finish({ started: true, port: 8080, pid: child.pid, note: 'ready (assumed)' });
            }
        }, 25000);
    });
}

exports.stopLabelStudioServer = () => {
    if (!labelStudioProc) return { stopped: false, reason: 'not running' };
    try {
        if (process.platform === 'win32') {
            // Windows: pakai taskkill /T (kill tree) supaya semua child process ikut mati
            spawn('taskkill', ['/pid', labelStudioProc.pid, '/T', '/F'], { shell: true });
        } else {
            labelStudioProc.kill('SIGTERM');
        }
    } catch (_) {}
    labelStudioProc = null;
    return { stopped: true };
};

exports.labelStudioStatus = () => ({
    running: !!labelStudioProc,
    pid: labelStudioProc?.pid,
    port: 8080,
});

// --- Workflow ---
exports.saveWorkflow = (root, projectName, steps, onFirstNG) => {
    const p = loadProject(root, projectName);
    steps.forEach((s, i) => s.stepIndex = i + 1);
    p.workflow = { steps, onFirstNG: onFirstNG || 'stop_and_report' };
    saveProject(root, p);
    return p.workflow;
};
