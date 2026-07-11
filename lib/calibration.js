// Auto-calibration (self-parametrization) engine.
//
// Konsep (lihat TA36 §2.2.6): daripada operator menebak-nebak nilai confidence
// threshold secara manual, aplikasi mengkalibrasi parameter deteksi sendiri
// dengan menyapu (sweep) beberapa kandidat confidence threshold pada split
// validasi berlabel, mengukur F1-Score deteksi cacat pada tiap threshold, lalu
// memilih threshold dengan F1 terbaik dan menuliskannya ke config. Ini
// mengadopsi konsep sistem vision yang mampu self-parametrize terhadap
// algoritma & data.
//
// Ground-truth level-gambar: sebuah gambar dianggap "NG/defective" bila file
// label YOLO-nya memuat minimal satu kelas selain "OK". Prediksi NG bila ada
// deteksi kelas selain "OK" dengan confidence >= threshold. Dari sini dihitung
// TP/FP/FN → Precision, Recall, F1 per threshold.

const fs = require('fs');
const path = require('path');
const inference = require('./inference');

const CANDIDATES = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60];

function listValImages(modelDir) {
    const imgDir = path.join(modelDir, 'dataset', 'images', 'val');
    const lblDir = path.join(modelDir, 'dataset', 'labels', 'val');
    if (!fs.existsSync(imgDir)) return [];
    return fs.readdirSync(imgDir)
        .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
        .map(f => ({
            img: path.join(imgDir, f),
            lbl: path.join(lblDir, f.replace(/\.(jpg|jpeg|png)$/i, '.txt')),
        }));
}

// Ground truth: gambar defective bila ada baris label dgn class_id yang BUKAN OK.
function isDefectiveGT(lblPath, classes) {
    if (!fs.existsSync(lblPath)) return false;
    const okIdx = classes.indexOf('OK');
    const lines = fs.readFileSync(lblPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const clsId = parseInt(line.split(/\s+/)[0], 10);
        if (Number.isNaN(clsId)) continue;
        if (clsId !== okIdx) return true; // ada kelas cacat
    }
    return false;
}

// Confidence prediksi cacat tertinggi pada sebuah gambar (0 kalau tak ada deteksi cacat).
function topDefectConfidence(detections) {
    let top = 0;
    for (const d of detections || []) {
        if (d.class_name !== 'OK' && d.confidence > top) top = d.confidence;
    }
    return top;
}

function f1(tp, fp, fn) {
    const p = tp + fp === 0 ? 0 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f = p + r === 0 ? 0 : (2 * p * r) / (p + r);
    return { precision: p, recall: r, f1: f };
}

// Kalibrasi. onProgress({done, total, image}) opsional untuk update UI.
// Return { bestConf, table:[{conf,precision,recall,f1}], evaluated, weightsPath }.
exports.calibrate = async (cfg, modelDir, classes, onProgress) => {
    const weightsPath = path.join(modelDir, 'weights', 'best.pt');
    if (!fs.existsSync(weightsPath)) {
        throw new Error('Model belum dilatih (best.pt tidak ada). Latih model dulu sebelum kalibrasi.');
    }
    const items = listValImages(modelDir);
    if (items.length === 0) {
        throw new Error('Tidak ada gambar di split val. Lakukan split dataset dulu.');
    }

    // Untuk tiap gambar: jalankan inferensi SEKALI pada conf rendah (0.05) agar
    // semua kandidat deteksi ikut terkumpul; thresholding dilakukan di JS.
    const perImage = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const b64 = fs.readFileSync(it.img).toString('base64');
        let detections = [];
        try {
            const r = await inference.inferOnce(cfg, weightsPath, b64, classes, {
                confidence: 0.05, iou: cfg.model.iou, imgsz: cfg.model.imgsz,
            });
            detections = r.detections || [];
        } catch (e) {
            // gambar gagal diinferensi — lewati, jangan gagalkan seluruh kalibrasi
            if (onProgress) onProgress({ done: i + 1, total: items.length, image: path.basename(it.img), error: e.message });
            continue;
        }
        perImage.push({
            gtDefective: isDefectiveGT(it.lbl, classes),
            topConf: topDefectConfidence(detections),
        });
        if (onProgress) onProgress({ done: i + 1, total: items.length, image: path.basename(it.img) });
    }

    if (perImage.length === 0) throw new Error('Tidak ada gambar yang berhasil diinferensi.');

    const table = CANDIDATES.map(conf => {
        let tp = 0, fp = 0, fn = 0, tn = 0;
        for (const p of perImage) {
            const predDefective = p.topConf >= conf;
            if (p.gtDefective && predDefective) tp++;
            else if (!p.gtDefective && predDefective) fp++;
            else if (p.gtDefective && !predDefective) fn++;
            else tn++;
        }
        const m = f1(tp, fp, fn);
        return { conf, tp, fp, fn, tn, ...m };
    });

    // Pilih F1 terbaik; kalau seri, pilih threshold lebih tinggi (lebih sedikit false alarm).
    let best = table[0];
    for (const row of table) {
        if (row.f1 > best.f1 + 1e-9 || (Math.abs(row.f1 - best.f1) < 1e-9 && row.conf > best.conf)) best = row;
    }

    return {
        bestConf: best.conf,
        bestF1: best.f1,
        table,
        evaluated: perImage.length,
        weightsPath,
    };
};
