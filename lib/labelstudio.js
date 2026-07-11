// Label Studio REST API client — auto-setup project, import gambar, export label.
// Docs: https://api.labelstud.io
//
// Cara dapat access token:
//   1. Buka Label Studio → klik avatar kanan atas → Account & Settings
//   2. Section "Access Token" → copy token
//   3. Paste ke Settings → Label Studio Access Token

const fs = require('fs');
const path = require('path');

// Auto-detect port (Label Studio kadang pindah dari 8080 ke 8081 kalau 8080 sudah dipakai)
let cachedBase = null;
async function getBase() {
    if (cachedBase) return cachedBase;
    for (const port of [8080, 8081, 8082, 8083]) {
        try {
            const r = await fetch(`http://localhost:${port}/health`, { method: 'GET' });
            if (r.ok || r.status === 401 || r.status === 403 || r.status === 404) {
                cachedBase = `http://localhost:${port}/api`;
                return cachedBase;
            }
        } catch (_) { /* try next port */ }
    }
    cachedBase = 'http://localhost:8080/api'; // default fallback
    return cachedBase;
}

// Auto-detect token type:
//   - JWT (Personal Access Token) starts with "eyJ" → butuh "Bearer <token>"
//   - Legacy Token adalah 40-char hex → butuh "Token <token>"
function cleanToken(token) {
    if (!token) return '';
    // Strip whitespace, newlines, quotes
    return String(token).trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
}

function authHeader(token) {
    const t = cleanToken(token);
    if (!t) return {};
    const isJWT = t.startsWith('eyJ') || t.length > 100;
    return { 'Authorization': isJWT ? `Bearer ${t}` : `Token ${t}` };
}

async function req(token, endpoint, opts = {}) {
    const BASE = await getBase();
    const headers = { ...authHeader(token), ...(opts.headers || {}) };
    console.log(`[LS] ${opts.method || 'GET'} ${BASE}${endpoint} — auth: ${headers.Authorization ? headers.Authorization.slice(0, 25) + '...' : 'NONE'} (token len: ${cleanToken(token).length})`);
    const res = await fetch(BASE + endpoint, {
        ...opts,
        headers,
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Label Studio API ${res.status} (${BASE}): ${txt.slice(0, 300)}`);
    }
    return res;
}

// Test connectivity + auth
exports.testAuth = async (token) => {
    try {
        const r = await req(token, '/projects/?page_size=1');
        return { ok: true, status: r.status };
    } catch (e) {
        return { ok: false, error: e.message };
    }
};

// Cek project existing untuk AutomaEyes project+model tertentu
// Return { found: bool, projectId?, taskCount?, annotationCount? }
exports.checkExistingProject = async (token, projectTitle) => {
    try {
        const proj = await exports.findProject(token, projectTitle);
        if (!proj) return { found: false };
        return {
            found: true,
            projectId: proj.id,
            taskCount: proj.task_number || 0,
            annotationCount: proj.total_annotations_number || 0,
        };
    } catch (e) {
        return { found: false, error: e.message };
    }
};

exports.getBase = getBase;

// Bangun XML label config sesuai AI Type model.
// User bisa customize kelas nya nanti di Label Studio → Settings → Labeling Interface.
function buildLabelConfig(classes, aiType = 'AI Detection') {
    const colors = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#06b6d4', '#84cc16'];
    const labelsXml = (tag) => classes.map((c, i) =>
        `    <${tag} value="${escapeXml(c)}" background="${colors[i % colors.length]}"/>`
    ).join('\n');
    const choicesXml = () => classes.map(c =>
        `    <Choice value="${escapeXml(c)}"/>`
    ).join('\n');

    switch (aiType) {
        case 'AI Segmentation':
            // Polygon labels untuk instance segmentation
            return `<View>
  <Image name="image" value="$image"/>
  <PolygonLabels name="label" toName="image">
${labelsXml('Label')}
  </PolygonLabels>
</View>`;

        case 'AI Classification':
            // Single-choice classification per gambar
            return `<View>
  <Image name="image" value="$image"/>
  <Choices name="label" toName="image" choice="single" showInline="true">
${choicesXml()}
  </Choices>
</View>`;

        case 'AI OCR':
            // Region + text transcription
            return `<View>
  <Image name="image" value="$image"/>
  <Labels name="label" toName="image">
${labelsXml('Label')}
  </Labels>
  <Rectangle name="rect" toName="image"/>
  <TextArea name="transcription" toName="image" editable="true" perRegion="true" required="true"/>
</View>`;

        case 'AI Detection':
        default:
            // Object Detection with Bounding Boxes
            return `<View>
  <Image name="image" value="$image"/>
  <RectangleLabels name="label" toName="image">
${labelsXml('Label')}
  </RectangleLabels>
</View>`;
    }
}

function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    }[c]));
}

// GET /api/projects/ → list all projects
exports.listProjects = async (token) => {
    const r = await req(token, '/projects/');
    const j = await r.json();
    return j.results || j;
};

// Cari project by title, return null kalau tidak ada
exports.findProject = async (token, title) => {
    const all = await exports.listProjects(token);
    return all.find(p => p.title === title) || null;
};

// POST /api/projects/ → create new project
exports.createProject = async (token, title, classes, description = '', aiType = 'AI Detection') => {
    const r = await req(token, '/projects/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title,
            description,
            label_config: buildLabelConfig(classes, aiType),
        }),
    });
    return r.json();
};

// POST /api/projects/{id}/import → upload files (multipart)
// Pakai global FormData + Blob (Node 18+). fileFromSync dari undici tidak reliable.
exports.importImages = async (token, projectId, filePaths) => {
    const form = new FormData();
    for (const p of filePaths) {
        if (!fs.existsSync(p)) continue;
        const buf = fs.readFileSync(p);
        const ext = path.extname(p).toLowerCase();
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
        const type = mimeMap[ext] || 'application/octet-stream';
        const blob = new Blob([buf], { type });
        form.append('file', blob, path.basename(p));
    }
    const r = await req(token, `/projects/${projectId}/import`, {
        method: 'POST',
        body: form,
    });
    return r.json();
};

// GET /api/projects/{id}/export?exportType=YOLO → download YOLO zip
exports.exportYOLO = async (token, projectId) => {
    const r = await req(token, `/projects/${projectId}/export?exportType=YOLO&download_all_tasks=true`);
    return Buffer.from(await r.arrayBuffer());
};

// Convenience: auto-setup project untuk model tertentu
// aiType: 'AI Detection' | 'AI Segmentation' | 'AI Classification' | 'AI OCR'
// Return { project, imported: N, alreadyExists: bool }
exports.setupProjectForModel = async (token, projectTitle, classes, imageFolder, description = '', aiType = 'AI Detection') => {
    // 1. Cek dulu apakah project dengan title itu sudah ada
    let project = await exports.findProject(token, projectTitle);
    let alreadyExists = false;
    if (project) {
        alreadyExists = true;
    } else {
        project = await exports.createProject(token, projectTitle, classes, description, aiType);
    }

    // 2. Import gambar dari dataset folder.
    // Dedup: kalau project sudah punya task untuk gambar tsb, JANGAN upload lagi
    // (mencegah task dobel saat Auto-Setup dijalankan berkali-kali).
    let imported = 0, skippedUpload = 0;
    const errors = [];
    let candidateFiles = [];
    const existingStems = alreadyExists ? await existingTaskStems(token, project.id) : new Set();
    if (fs.existsSync(imageFolder)) {
        candidateFiles = fs.readdirSync(imageFolder)
            .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
            .filter(f => !f.includes('.aug'))  // skip augmented — cukup upload originals
            .map(f => path.join(imageFolder, f));

        // Upload 1 per 1 supaya kalau ada file corrupt tidak gagal semua
        for (const filePath of candidateFiles) {
            if (existingStems.has(path.parse(filePath).name)) { skippedUpload++; continue; }
            try {
                await exports.importImages(token, project.id, [filePath]);
                imported++;
            } catch (e) {
                errors.push(`${path.basename(filePath)}: ${e.message.slice(0, 100)}`);
            }
        }
    } else {
        errors.push(`Folder gambar tidak ada: ${imageFolder}`);
    }

    // 3. Muat ulang anotasi lama dari git (label YOLO) → jadi anotasi editable.
    //    Ini yang bikin project bisa diedit di device manapun walau database
    //    Label Studio-nya baru/kosong. Hanya untuk model deteksi (bbox YOLO).
    let restored = { loaded: 0, skipped: 0, noLabel: 0 };
    const isDetection = !aiType || aiType === 'AI Detection';
    if (isDetection) {
        try {
            // imageFolder = <dataset>/images/train → naik 2 level ke <dataset>.
            const datasetDir = path.resolve(imageFolder, '..', '..');
            restored = await exports.importExistingLabels(token, project.id, datasetDir, classes);
        } catch (e) {
            errors.push(`Re-import label: ${e.message.slice(0, 120)}`);
        }
    }

    const base = await getBase();
    const uiBase = base.replace('/api', '');
    return {
        project,
        imported,
        skippedUpload,          // gambar yang sudah ada di project, tidak di-upload lagi
        found: candidateFiles.length,
        alreadyExists,
        restored,               // { loaded, skipped, noLabel } — anotasi dipulihkan dari git
        errors,
        projectUrl: `${uiBase}/projects/${project.id}`,
    };
};

// ============================================================================
// RE-IMPORT anotasi lintas-device.
// Masalah: database Label Studio (akun/project/anotasi) itu LOKAL per-device &
// tidak ikut git. Tapi hasil anotasi tersimpan sebagai label YOLO di
// dataset/labels/train/*.txt yang IKUT git. Fungsi di bawah memuat ulang label
// YOLO itu jadi anotasi Label Studio yang bisa langsung diedit di device manapun.
// ============================================================================

// Konversi 1 file label YOLO → array "result" anotasi Label Studio.
// YOLO : "<classIdx> <cx> <cy> <w> <h>" (ternormalisasi 0..1, berbasis center).
// LS   : x,y,width,height dalam PERSEN 0..100 (x,y = pojok kiri-atas).
// Keduanya relatif terhadap dimensi gambar → tidak butuh ukuran piksel asli.
function yoloToLSResult(labelText, classes) {
    const out = [];
    (labelText || '').split(/\r?\n/).forEach(line => {
        const p = line.trim().split(/\s+/);
        if (p.length < 5) return;
        const ci = parseInt(p[0], 10);
        const cx = parseFloat(p[1]), cy = parseFloat(p[2]), w = parseFloat(p[3]), h = parseFloat(p[4]);
        if ([ci, cx, cy, w, h].some(v => Number.isNaN(v))) return;
        const cls = classes[ci] || classes[0] || 'object';
        out.push({
            from_name: 'label', to_name: 'image', type: 'rectanglelabels',
            value: {
                x: Math.max(0, (cx - w / 2) * 100),
                y: Math.max(0, (cy - h / 2) * 100),
                width: w * 100, height: h * 100, rotation: 0,
                rectanglelabels: [cls],
            },
        });
    });
    return out;
}

// Ambil semua task sebuah project (paginasi sederhana, tahan beda versi API).
async function listTasks(token, projectId) {
    const tasks = [];
    for (let page = 1; page <= 200; page++) {
        const r = await req(token, `/projects/${projectId}/tasks/?page=${page}&page_size=500`);
        const j = await r.json();
        const batch = Array.isArray(j) ? j : (j.tasks || j.results || []);
        if (!batch.length) break;
        tasks.push(...batch);
        if (batch.length < 500) break;
    }
    return tasks;
}

// Kumpulan "stem" nama gambar yang SUDAH jadi task di project (prefix hash dibuang).
// Dipakai untuk dedup upload supaya Auto-Setup tidak bikin task dobel.
async function existingTaskStems(token, projectId) {
    const set = new Set();
    try {
        const tasks = await listTasks(token, projectId);
        tasks.forEach(t => {
            const raw = t.data && (t.data.image || t.data.img || Object.values(t.data || {})[0]);
            if (!raw) return;
            const stem = path.parse(decodeURIComponent(String(raw))).name.replace(/^[0-9a-fA-F]{6,}-/, '');
            set.add(stem);
        });
    } catch (_) { /* kalau gagal list, anggap kosong → tetap upload */ }
    return set;
}

// POST 1 anotasi editable ke sebuah task.
async function addAnnotation(token, taskId, result) {
    await req(token, `/tasks/${taskId}/annotations/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result, was_cancelled: false, ground_truth: false }),
    });
}

// Muat ulang label YOLO dari git → anotasi editable di Label Studio.
// Hanya menambah ke task yang BELUM punya anotasi supaya tidak dobel kalau
// Auto-Setup dijalankan lagi. Return { loaded, skipped, noLabel }.
exports.importExistingLabels = async (token, projectId, datasetDir, classes) => {
    const labelsDir = path.join(datasetDir, 'labels', 'train');
    if (!fs.existsSync(labelsDir)) return { loaded: 0, skipped: 0, noLabel: 0 };

    // Peta stem-nama → isi file label (skip label augmentasi & classes.txt).
    const labelByStem = {};
    fs.readdirSync(labelsDir).forEach(f => {
        if (!f.toLowerCase().endsWith('.txt') || f === 'classes.txt') return;
        if (f.includes('.aug')) return;
        labelByStem[path.parse(f).name] = fs.readFileSync(path.join(labelsDir, f), 'utf8');
    });

    const tasks = await listTasks(token, projectId);
    let loaded = 0, skipped = 0, noLabel = 0;
    for (const t of tasks) {
        const hasAnn = (t.total_annotations || (Array.isArray(t.annotations) ? t.annotations.length : 0)) > 0;
        if (hasAnn) { skipped++; continue; }

        // Nama gambar diambil dari task.data (biasanya field "image").
        const raw = t.data && (t.data.image || t.data.img || Object.values(t.data)[0]);
        if (!raw) { noLabel++; continue; }
        const stem = path.parse(decodeURIComponent(String(raw))).name;

        // Cocokkan langsung, lalu coba buang prefix hash "<hash>-" dari Label Studio.
        let text = labelByStem[stem];
        if (text == null) text = labelByStem[stem.replace(/^[0-9a-fA-F]{6,}-/, '')];
        if (text == null) { noLabel++; continue; }

        const result = yoloToLSResult(text, classes);
        if (!result.length) { noLabel++; continue; }
        try { await addAnnotation(token, t.id, result); loaded++; }
        catch (_) { /* satu task gagal jangan hentikan sisanya */ }
    }
    return { loaded, skipped, noLabel };
};

// Convert YOLO export zip → simpan labels ke dataset/labels/train/
exports.extractYOLOToDataset = async (token, projectId, datasetDir) => {
    const AdmZip = require('adm-zip');
    const zipBuf = await exports.exportYOLO(token, projectId);
    const zip = new AdmZip(zipBuf);
    const labelsDir = path.join(datasetDir, 'labels', 'train');
    if (!fs.existsSync(labelsDir)) fs.mkdirSync(labelsDir, { recursive: true });

    // Kumpulkan stem gambar train yang ada, supaya nama label bisa dicocokkan.
    // Label Studio meng-export label dengan prefix hash (mis. "075539b7-WIN_x.txt")
    // sedangkan gambar kita bernama "WIN_x.jpg". YOLO mencocokkan label↔gambar
    // dari NAMA (stem) yang sama PERSIS — jadi prefix hash HARUS dibuang, kalau
    // tidak semua anotasi dianggap "tidak ada" saat training.
    const imagesDir = path.join(datasetDir, 'images', 'train');
    const imageStems = new Set();
    if (fs.existsSync(imagesDir)) {
        fs.readdirSync(imagesDir).forEach(f => {
            if (/\.(jpg|jpeg|png)$/i.test(f) && !f.includes('.aug')) {
                imageStems.add(path.parse(f).name);
            }
        });
    }
    // Tentukan nama file label yang match gambar.
    const matchName = (baseName) => {
        const stem = baseName.replace(/\.txt$/i, '');
        if (imageStems.has(stem)) return stem + '.txt';
        const stripped = stem.replace(/^[0-9a-fA-F]{6,}-/, ''); // buang <hash>-
        if (imageStems.has(stripped)) return stripped + '.txt';
        for (const s of imageStems) {                            // fallback: suffix match
            if (stem.endsWith('-' + s) || stem.endsWith('_' + s)) return s + '.txt';
        }
        return stripped + '.txt'; // tetap buang prefix hash biar konsisten
    };

    let extracted = 0;
    zip.getEntries().forEach(entry => {
        // Label Studio YOLO export punya struktur: labels/<file>.txt, classes.txt, notes.json
        if (entry.entryName.startsWith('labels/') && entry.entryName.endsWith('.txt')) {
            const outName = matchName(path.basename(entry.entryName));
            fs.writeFileSync(path.join(labelsDir, outName), entry.getData());
            extracted++;
        }
        if (entry.entryName === 'classes.txt') {
            fs.writeFileSync(path.join(datasetDir, 'classes.txt'), entry.getData());
        }
    });
    return { extracted, labelsDir };
};
