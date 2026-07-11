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

    // 2. Import gambar dari dataset folder
    // Always try to upload — user bisa panggil Auto-Setup lagi kalau tambah gambar
    let imported = 0;
    const errors = [];
    let candidateFiles = [];
    if (fs.existsSync(imageFolder)) {
        candidateFiles = fs.readdirSync(imageFolder)
            .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
            .filter(f => !f.includes('.aug'))  // skip augmented — cukup upload originals
            .map(f => path.join(imageFolder, f));

        // Upload 1 per 1 supaya kalau ada file corrupt tidak gagal semua
        for (const filePath of candidateFiles) {
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

    const base = await getBase();
    const uiBase = base.replace('/api', '');
    return {
        project,
        imported,
        found: candidateFiles.length,
        alreadyExists,
        errors,
        projectUrl: `${uiBase}/projects/${project.id}`,
    };
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
