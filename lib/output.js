// Output recorder — NG image save + daily summary CSV.
//
// Layout:
//   <project>/outputs/YYYY-MM-DD/NNN-HHMM.jpg + .json
//   <project>/outputs/daily_summary.csv

const fs = require('fs');
const path = require('path');

const dailyCounts = {}; // { 'ProjectName|YYYY-MM-DD': counter }

exports.record = (project, imageBase64, runResult, cfg) => {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const timeStr = hh + mm;

    const dayDir = path.join(project.dir, 'outputs', dayKey);
    if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

    // Counter berdasarkan file yang sudah ada (resume-safe)
    const key = `${project.name}|${dayKey}`;
    if (dailyCounts[key] === undefined) {
        dailyCounts[key] = fs.readdirSync(dayDir).filter(f => f.endsWith('.jpg')).length;
    }
    dailyCounts[key]++;
    const seq = dailyCounts[key];
    const seqStr = String(seq).padStart(3, '0');

    const stem = `${seqStr}-${timeStr}`;
    // Flag dari step Options (kalau ada) menang atas setelan global.
    const isNG = runResult.finalVerdict === 'NG';
    const saveImg = isNG
        ? (runResult.saveNG !== false)                                  // NG: simpan, kecuali Options mematikannya
        : (runResult.saveOK === true || cfg.output.save_ok_images);     // OK: simpan hanya jika diminta

    let imgPath = null, metaPath = null;
    if (saveImg) {
        imgPath = path.join(dayDir, stem + '.jpg');
        const buf = Buffer.from(imageBase64, 'base64');
        fs.writeFileSync(imgPath, buf);

        metaPath = path.join(dayDir, stem + '.json');
        fs.writeFileSync(metaPath, JSON.stringify({
            seq, timestamp: now.toISOString(),
            finalVerdict: runResult.finalVerdict,
            totalMS: runResult.totalMS,
            steps: runResult.steps,
            image: stem + '.jpg',
        }, null, 2));
    }

    // Append ke daily_summary.csv
    const csvPath = path.join(project.dir, 'outputs', 'daily_summary.csv');
    const isNew = !fs.existsSync(csvPath);
    const stepsStr = runResult.steps.map(s =>
        `${s.modelName || s.label || s.category}:${s.verdict}(${(s.confidence || 0).toFixed(2)})`
    ).join(';');
    const row = [
        dayKey, seqStr, now.toISOString(),
        runResult.finalVerdict, (runResult.totalMS || 0).toFixed(1),
        stepsStr,
    ].join(',') + '\n';
    if (isNew) {
        fs.writeFileSync(csvPath, 'date,seq,timestamp,final_verdict,total_ms,steps\n' + row);
    } else {
        fs.appendFileSync(csvPath, row);
    }

    return { seq, imgPath, metaPath, csvPath };
};

exports.dailySummary = (projectDir, dayKey) => {
    const csvPath = path.join(projectDir, 'outputs', 'daily_summary.csv');
    if (!fs.existsSync(csvPath)) return { total: 0, ok: 0, ng: 0, avgCycleMS: 0, byStep: {} };
    const rows = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1).filter(Boolean);
    let total = 0, ok = 0, ng = 0, msSum = 0;
    const byStep = {};
    for (const row of rows) {
        const [date, , , verdict, ms, steps] = row.split(',');
        if (date !== dayKey) continue;
        total++;
        if (verdict === 'OK') ok++;
        else {
            ng++;
            (steps || '').split(';').forEach(part => {
                const [step, verd] = part.split(':');
                if (verd && verd.startsWith('NG')) byStep[step] = (byStep[step] || 0) + 1;
            });
        }
        msSum += parseFloat(ms) || 0;
    }
    return {
        date: dayKey, total, ok, ng,
        avgCycleMS: total > 0 ? msSum / total : 0,
        byStep,
    };
};
