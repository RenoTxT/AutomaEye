// Workflow executor — chain semua model, aggregate verdict, save output.

const path = require('path');
const inference = require('./inference');
const selflearning = require('./selflearning');

// ---- Evaluasi Add-ons (Rule-based Tools) ----
// Menentukan OK/NG dari hasil deteksi YOLO berdasarkan add-on yang diaktifkan
// per-model. Semua add-on harus lulus → OK; satu saja gagal → NG.
// Return { verdict, checks:[{addon, pass, detail}], minConf }.
function evaluateAddons(m, detections) {
    const dets = detections || [];
    const addons = m.addons || [];
    const acfg = m.addonConfig || {};
    const checks = [];
    const has = (name) => addons.includes(name);
    const minConf = dets.length ? Math.min(...dets.map(d => d.confidence || 0)) : 0;
    let verdict = 'OK';

    // Presence Check — part harus ADA (minimal 1 objek terdeteksi).
    if (has('Presence Check')) {
        const pass = dets.length >= 1;
        checks.push({ addon: 'Presence Check', pass, detail: pass ? `${dets.length} objek terdeteksi` : 'Tidak ada objek — part hilang' });
        if (!pass) verdict = 'NG';
    }

    // Count — jumlah objek harus PAS sama dengan target (aturan =N).
    if (has('Count')) {
        const expected = Number.isFinite(acfg.countExpected) ? acfg.countExpected : null;
        if (expected == null) {
            checks.push({ addon: 'Count', pass: true, detail: `Target belum diatur (${dets.length} terdeteksi)` });
        } else {
            const pass = dets.length === expected;
            checks.push({ addon: 'Count', pass, detail: `${dets.length}/${expected} objek` });
            if (!pass) verdict = 'NG';
        }
    }

    // GD&T Measurement — ukur dimensi PER KELAS: tiap kelas punya jenis ukur,
    // nominal, dan toleransi sendiri (mirip tool terpisah di Keyence).
    // Ukuran diambil dari kontur mask (segmentation, presisi) kalau ada, else kotak.
    // mm = piksel × mmPerPixel (kalibrasi global, satu untuk semua kelas).
    if (has('GD&T Measurement')) {
        const g = acfg.gdt || {};
        const mmpp = Number(g.mmPerPixel) || 0;
        const perClass = g.perClass || null;
        // Resolusi spesifikasi untuk sebuah kelas (dukung format lama single-config).
        const specFor = (cls) => {
            if (perClass && perClass[cls] && Number.isFinite(Number(perClass[cls].nominalMM))) return perClass[cls];
            if (!perClass && Number.isFinite(Number(g.nominalMM))) return { measure: g.measure, nominalMM: g.nominalMM, toleranceMM: g.toleranceMM };
            return null;
        };
        const pxFor = (d, measure) => {
            if (d.measure) {
                const key = measure === 'width' ? 'widthPx' : measure === 'height' ? 'heightPx' : 'diameterPx';
                return d.measure[key] || 0;
            }
            const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
            return measure === 'width' ? w : measure === 'height' ? h : (w + h) / 2;
        };

        if (!mmpp) {
            checks.push({ addon: 'GD&T', pass: true, detail: 'Belum dikalibrasi (mm/piksel)' });
        } else if (!dets.length) {
            checks.push({ addon: 'GD&T', pass: false, detail: 'Tidak ada objek untuk diukur' });
            verdict = 'NG';
        } else {
            const parts = [];
            let anyMeasured = false, allPass = true;
            dets.forEach(d => {
                const spec = specFor(d.class_name);
                if (!spec) return;                       // kelas tanpa spek → tidak diukur
                anyMeasured = true;
                const nominal = Number(spec.nominalMM), tol = Number(spec.toleranceMM) || 0;
                const val = pxFor(d, spec.measure) * mmpp;
                const ok = Math.abs(val - nominal) <= tol;
                if (!ok) allPass = false;
                parts.push(`${d.class_name} ${val.toFixed(2)}mm${ok ? '' : ` ✗(${nominal}±${tol})`}`);
            });
            if (!anyMeasured) {
                checks.push({ addon: 'GD&T', pass: true, detail: 'Kelas terdeteksi belum punya spesifikasi ukur' });
            } else {
                checks.push({ addon: 'GD&T', pass: allPass, detail: parts.join(' · ') });
                if (!allPass) verdict = 'NG';
            }
        }
    }

    // Tidak ada add-on aktif → default: objek terdeteksi berarti OK.
    if (checks.length === 0) {
        const pass = dets.length >= 1;
        checks.push({ addon: 'Deteksi', pass, detail: pass ? `${dets.length} objek` : 'Tidak ada objek' });
        verdict = pass ? 'OK' : 'NG';
    }

    return { verdict, checks, minConf };
}
exports.evaluateAddons = evaluateAddons;

// Jalankan satu step sesuai KATEGORINYA. Mengisi sr (verdict, reason, dll).
// ctx = { cfg, project, base64, arduino, result }.
async function runStep(step, sr, ctx) {
    const { cfg, project, base64, arduino, result } = ctx;
    const cat = step.category;
    const config = step.config || {};

    // Model dipakai oleh Inspection & Positioning.
    const needModel = (cat === 'Inspection' || cat === 'Positioning');
    let m = null;
    if (needModel) {
        m = project.models.find(x => x.name === step.modelName);
        if (!m || !m.trained) {
            sr.verdict = 'ERROR';
            sr.error = `Model ${step.modelName || '(kosong)'} belum trained / tidak ada`;
            return;
        }
    }

    // ---- CAPTURE — sumber & mutu gambar (bukan analisis) ----
    if (cat === 'Capture') {
        const bytes = Math.floor((base64 || '').length * 3 / 4);
        const kb = Math.round(bytes / 1024);
        const minKB = Number(config.minKB) || 0;   // gate opsional: tolak gambar kosong/terlalu kecil
        if (!base64) {
            sr.verdict = 'NG'; sr.reason = 'Tidak ada gambar dari sumber';
        } else if (minKB && kb < minKB) {
            sr.verdict = 'NG'; sr.reason = `Gambar ${kb}KB < minimum ${minKB}KB (kemungkinan gagal capture)`;
        } else {
            sr.verdict = 'OK'; sr.reason = `Sumber: ${config.source || 'kamera'} · gambar ${kb}KB diterima`;
        }
        return;
    }

    // ---- POSITIONING — kunci lokasi part pakai deteksi ----
    if (cat === 'Positioning') {
        const weightsPath = path.join(m.dir, 'weights', 'best.pt');
        const r = await inference.inferOnce(cfg, weightsPath, base64, m.classes, {
            confidence: cfg.model.confidence, iou: cfg.model.iou, imgsz: cfg.model.imgsz,
        });
        const dets = r.detections || [];
        sr.detections = dets;
        if (!dets.length) {
            sr.verdict = 'NG'; sr.reason = 'Part tidak ditemukan — posisi tidak terkunci';
        } else {
            // Anchor = kotak terbesar (part utama). Simpan untuk step berikutnya.
            const main = dets.reduce((a, d) =>
                ((d.x2 - d.x1) * (d.y2 - d.y1)) > ((a.x2 - a.x1) * (a.y2 - a.y1)) ? d : a, dets[0]);
            const cx = Math.round((main.x1 + main.x2) / 2), cy = Math.round((main.y1 + main.y2) / 2);
            result.anchor = { cx, cy, box: main };
            sr.confidence = main.confidence || 0;
            sr.verdict = 'OK'; sr.reason = `Part terkunci di (${cx}, ${cy})`;
        }
        return;
    }

    // ---- INSPECTION — deteksi + add-ons (Presence/Count/GD&T) ----
    if (cat === 'Inspection') {
        const weightsPath = path.join(m.dir, 'weights', 'best.pt');
        const r = await inference.inferOnce(cfg, weightsPath, base64, m.classes, {
            confidence: cfg.model.confidence, iou: cfg.model.iou, imgsz: cfg.model.imgsz,
        });
        sr.detections = r.detections || [];
        const ev = evaluateAddons(m, sr.detections);
        sr.verdict = ev.verdict;
        sr.checks = ev.checks;
        sr.confidence = ev.minConf;
        sr.reason = ev.checks.filter(c => !c.pass).map(c => `${c.addon}: ${c.detail}`).join('; ')
            || ev.checks.map(c => `${c.addon}: ${c.detail}`).join('; ');
        return;
    }

    // ---- COMMUNICATION — kirim hasil ke luar (Arduino/PLC) ----
    if (cat === 'Communication') {
        const ng = result.finalVerdict === 'NG';
        const onlyOnNG = config.onlyOnNG !== false;   // default: kirim hanya saat NG
        const sig = ng ? (config.signalNG != null ? config.signalNG : cfg.arduino.ng_signal)
                       : (config.signalOK != null ? config.signalOK : cfg.arduino.ok_signal);
        if (ng || !onlyOnNG) {
            try { await arduino.send(String(sig)); sr.reason = `Kirim sinyal '${String(sig).trim()}' ke Arduino`; }
            catch (e) { sr.reason = `Gagal kirim sinyal: ${e.message}`; }
        } else {
            sr.reason = 'Hasil OK — tidak ada sinyal (onlyOnNG)';
        }
        sr.verdict = 'OK';   // komunikasi tidak menilai part
        return;
    }

    // ---- OPTIONS — flag tambahan (simpan gambar, dll) ----
    if (cat === 'Options') {
        if (config.saveOK != null) result.saveOK = !!config.saveOK;
        if (config.saveNG != null) result.saveNG = !!config.saveNG;
        sr.verdict = 'OK';
        sr.reason = `Simpan OK: ${result.saveOK ? 'ya' : 'tidak'} · Simpan NG: ${result.saveNG === false ? 'tidak' : 'ya'}`;
        return;
    }

    // Kategori tak dikenal → lewati tanpa memengaruhi verdict.
    sr.verdict = 'OK';
    sr.reason = '(kategori belum didukung)';
}

exports.execute = async (cfg, project, imageDataUrl, arduino, output) => {
    // Strip data URL prefix
    const base64 = imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');

    if (!project.workflow.steps || project.workflow.steps.length === 0) {
        throw new Error('Workflow kosong. Buat workflow dulu.');
    }

    const start = Date.now();
    const result = {
        timestamp: new Date().toISOString(),
        finalVerdict: 'OK',
        steps: [],
    };

    const stopOnFirstNG = project.workflow.onFirstNG === 'stop_and_report';
    const steps = project.workflow.steps;
    const hasCommStep = steps.some(s => s.category === 'Communication');

    for (const step of steps) {
        const label = step.modelName || step.label || step.tool || step.category;
        const sr = {
            stepIndex: step.stepIndex,
            category: step.category,
            modelName: step.modelName,
            label,
            verdict: 'OK',
            confidence: 0,
        };
        const stepStart = Date.now();
        try {
            await runStep(step, sr, { cfg, project, base64, arduino, result });
        } catch (e) {
            sr.verdict = 'ERROR';
            sr.error = e.message;
        }
        sr.stepMS = Date.now() - stepStart;

        result.steps.push(sr);
        if (sr.verdict === 'NG' || sr.verdict === 'ERROR') {
            result.finalVerdict = 'NG';
            if (stopOnFirstNG) break;
        }
        if (step.continueOn === 'on_ok' && sr.verdict !== 'OK') break;
        if (step.continueOn === 'on_ng' && sr.verdict !== 'NG') break;
    }

    result.totalMS = Date.now() - start;

    // Save output (honor Options step flags saveOK/saveNG).
    try {
        const saved = output.record(project, base64, result, cfg);
        result.savedTo = saved.imgPath;
    } catch (e) {
        console.warn('save output failed:', e.message);
    }

    // Sinyal Arduino default hanya kalau TIDAK ada step Communication eksplisit
    // (kalau ada, step itu yang mengatur sinyal — hindari kirim dobel).
    try {
        if (!hasCommStep) {
            if (result.finalVerdict === 'NG') {
                await arduino.send(cfg.arduino.ng_signal);
            } else if (cfg.arduino.signal_on_ok) {
                await arduino.send(cfg.arduino.ok_signal);
            }
        }
    } catch (e) { /* non-fatal */ }

    // Self-learning: kumpulkan hard sample bila unit ini tergolong "ragu".
    try {
        result.selfLearning = selflearning.collect(cfg, project, base64, result);
    } catch (e) {
        result.selfLearning = { collected: false, reason: e.message };
    }

    return result;
};
