// Self-learning (active learning) engine.
//
// Konsep (lihat TA36 §2.2.5): saat mode Self-Learning aktif, setiap unit yang
// diinspeksi dengan tingkat keyakinan (confidence) berada di "zona ragu"
// [uncertainty_low, uncertainty_high] dianggap SAMPEL SULIT (hard sample) — yaitu
// sampel paling informatif menurut uncertainty sampling. Sampel ini otomatis
// dikumpulkan untuk dianotasi ulang, lalu ketika jumlahnya mencapai
// retrain_every_n, aplikasi memicu retraining sehingga akurasi meningkat
// seiring waktu (self-improving model).
//
// Layout penyimpanan:
//   <project>/self_learning/<model>/hard_samples/<seq>-<time>.jpg (+ .json)
//   <project>/self_learning/<model>/archive/   (setelah dipakai retraining)

const fs = require('fs');
const path = require('path');

function slDir(project, modelName) {
    return path.join(project.dir, 'self_learning', modelName);
}
function hardDir(project, modelName) {
    return path.join(slDir(project, modelName), 'hard_samples');
}

// Skor ketidakpastian sebuah run = confidence deteksi yang PALING dekat 0.5
// (paling ambigu). Kalau tidak ada deteksi sama sekali, run dianggap tidak ragu.
function uncertaintyOf(runResult) {
    let best = null; // confidence terdekat ke 0.5
    for (const s of runResult.steps || []) {
        const dets = s.detections || [];
        for (const d of dets) {
            const c = typeof d.confidence === 'number' ? d.confidence : null;
            if (c === null) continue;
            if (best === null || Math.abs(c - 0.5) < Math.abs(best - 0.5)) best = c;
        }
        // Fallback: kalau step tidak membawa detail deteksi, pakai confidence step.
        if (dets.length === 0 && typeof s.confidence === 'number' && s.confidence > 0 && s.confidence < 1) {
            const c = s.confidence;
            if (best === null || Math.abs(c - 0.5) < Math.abs(best - 0.5)) best = c;
        }
    }
    return best; // null = tidak bisa dinilai
}

// Apakah run ini "hard sample" menurut band ketidakpastian di config.
function isUncertain(runResult, cfg) {
    const sl = cfg.self_learning || {};
    const lo = typeof sl.uncertainty_low === 'number' ? sl.uncertainty_low : 0.3;
    const hi = typeof sl.uncertainty_high === 'number' ? sl.uncertainty_high : 0.7;
    const u = uncertaintyOf(runResult);
    if (u === null) return false;
    return u >= lo && u <= hi;
}

// Hitung jumlah hard sample yang menunggu (belum dipakai retraining).
function pendingCount(project, modelName) {
    const d = hardDir(project, modelName);
    if (!fs.existsSync(d)) return 0;
    return fs.readdirSync(d).filter(f => f.toLowerCase().endsWith('.jpg')).length;
}

// Nama model yang paling relevan untuk atribusi hard sample:
// model pertama yang menghasilkan verdict penentu (NG) atau step terakhir.
function decidingModel(runResult) {
    const steps = runResult.steps || [];
    const ng = steps.find(s => s.verdict === 'NG');
    if (ng) return ng.modelName;
    return steps.length ? steps[steps.length - 1].modelName : 'model';
}

// Kumpulkan hard sample bila mode aktif dan run tergolong ragu.
// Return { collected, count, needsRetrain, modelName, uncertainty }.
exports.collect = (cfg, project, imageBase64, runResult) => {
    const sl = cfg.self_learning || {};
    if (!sl.enabled) return { collected: false, reason: 'disabled' };
    if (!isUncertain(runResult, cfg)) return { collected: false, reason: 'confident' };

    const modelName = decidingModel(runResult);
    const d = hardDir(project, modelName);
    fs.mkdirSync(d, { recursive: true });

    const now = new Date();
    const stem = `${now.toISOString().replace(/[:.]/g, '-')}`;
    const imgPath = path.join(d, stem + '.jpg');
    fs.writeFileSync(imgPath, Buffer.from(imageBase64, 'base64'));
    fs.writeFileSync(path.join(d, stem + '.json'), JSON.stringify({
        timestamp: now.toISOString(),
        uncertainty: uncertaintyOf(runResult),
        finalVerdict: runResult.finalVerdict,
        steps: runResult.steps,
    }, null, 2));

    const count = pendingCount(project, modelName);
    const need = sl.retrain_every_n || 100;
    return {
        collected: true,
        modelName,
        count,
        needsRetrain: count >= need,
        uncertainty: uncertaintyOf(runResult),
    };
};

// Status untuk UI: berapa hard sample menunggu vs ambang retrain.
exports.status = (project, modelName, cfg) => {
    const need = (cfg.self_learning && cfg.self_learning.retrain_every_n) || 100;
    const count = pendingCount(project, modelName);
    return { enabled: !!(cfg.self_learning && cfg.self_learning.enabled), pending: count, retrainEvery: need, needsRetrain: count >= need };
};

// Setelah hard sample dianotasi & dipindah ke dataset training, arsipkan
// supaya counter reset (tidak memicu retraining berulang).
exports.archive = (project, modelName) => {
    const src = hardDir(project, modelName);
    if (!fs.existsSync(src)) return { moved: 0 };
    const dst = path.join(slDir(project, modelName), 'archive', new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dst, { recursive: true });
    let moved = 0;
    for (const f of fs.readdirSync(src)) {
        fs.renameSync(path.join(src, f), path.join(dst, f));
        moved++;
    }
    return { moved };
};

exports._uncertaintyOf = uncertaintyOf;
exports._isUncertain = isUncertain;
