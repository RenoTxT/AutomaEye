// NVIDIA NIM (build.nvidia.com) client — chat completion API OpenAI-compatible.
// Pakai fetch native Node.js 18+.

const path = require('path');
const output = require('./output');
const projects = require('./projects');

// Base URL bisa diganti di Settings (OpenAI-compatible provider apa pun).
// Default: NVIDIA NIM.
function chatEndpoint(cfg) {
    const base = (cfg.nvidia && cfg.nvidia.base_url) || 'https://api.cosmoshub.tech/v1';
    return base.replace(/\/+$/, '') + '/chat/completions';
}

async function chat(cfg, messages, timeoutMs) {
    if (!cfg.nvidia.api_key) throw new Error('API key kosong (Settings)');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
    try {
        const res = await fetch(chatEndpoint(cfg), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${cfg.nvidia.api_key}`,
            },
            body: JSON.stringify({
                model: cfg.nvidia.model || 'qwen-3.7-max',
                messages,
                temperature: 0.3,
                max_tokens: 2048,
                stream: false,
            }),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`AI API ${res.status}: ${err.slice(0, 300)}`);
        }
        const j = await res.json();
        return j.choices[0].message.content;
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('Timeout: server AI tidak merespon (cek base URL / model / koneksi).');
        throw e;
    } finally { clearTimeout(to); }
}

exports.chat = (cfg, messages) => chat(cfg, messages);

// ---- Vision (VLM) — untuk triage hard sample self-learning ----
// Format gambar menyesuaikan provider: NVIDIA pakai tag <img> di teks;
// provider OpenAI-standar (mis. CosmosHub) pakai image_url array.
async function visionChat(cfg, imageBase64, prompt, model, timeoutMs) {
    const key = (cfg.self_learning && cfg.self_learning.api_key) || cfg.nvidia.api_key;
    if (!key) throw new Error('API key kosong (Settings)');
    const base = (cfg.nvidia && cfg.nvidia.base_url) || '';
    const isNvidia = /nvidia\.com/i.test(base);
    const content = isNvidia
        ? `${prompt} <img src="data:image/jpeg;base64,${imageBase64}" />`
        : [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ];
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    try {
        const res = await fetch(chatEndpoint(cfg), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: model || (cfg.nvidia && cfg.nvidia.model) || 'qwen-3.7-max',
                messages: [{ role: 'user', content }],
                max_tokens: 256, temperature: 0.2, stream: false,
            }),
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`VLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = await res.json();
        return j.choices[0].message.content;
    } finally { clearTimeout(to); }
}
exports.visionChat = visionChat;

// Triage sebuah hard sample → { verdict:'OK'|'NG'|null, text }.
// Saran ini untuk DITINJAU manusia, bukan label otomatis.
exports.triageSample = async (cfg, imageBase64, classes) => {
    const cl = (classes && classes.length) ? classes.join(', ') : 'objek/part';
    const prompt = `Anda inspektur quality control. Gambar ini adalah part industri (fitur relevan: ${cl}). ` +
        `Nilai apakah tampak NORMAL atau ada KELAINAN (cacat, goresan, bentuk/ukuran janggal, komponen hilang). ` +
        `Jawab SATU baris dengan format persis: "VERDICT: OK|NG | ALASAN: <alasan singkat>".`;
    const text = await visionChat(cfg, imageBase64, prompt, cfg.self_learning && cfg.self_learning.vision_model);
    const m = (text || '').match(/VERDICT:\s*(OK|NG)/i);
    return { verdict: m ? m[1].toUpperCase() : null, text: (text || '').trim() };
};

// ---- Report generation ----
exports.generateReport = async (cfg, root, projectName, dateStr) => {
    const p = projects.load(root, projectName);
    const summary = output.dailySummary(p.dir, dateStr);
    const systemMsg = `You are a manufacturing quality control analyst. Write concise,
factual daily reports in Bahasa Indonesia. Use structured markdown with:
1. Ringkasan (1-2 kalimat)
2. Statistik utama (bullet list)
3. Analisa distribusi cacat
4. Root cause dugaan (kalau ada pola)
5. Rekomendasi tindakan
Do not invent numbers. Only use data provided.`;

    const dataStr = [
        `Data inspeksi tanggal ${dateStr} untuk project ${projectName}:`,
        `- Total: ${summary.total}`,
        `- OK: ${summary.ok}`,
        `- NG: ${summary.ng}`,
        summary.total > 0 ? `- Success rate: ${(summary.ok / summary.total * 100).toFixed(2)}%` : '',
        `- Waktu siklus rata-rata: ${summary.avgCycleMS.toFixed(1)} ms`,
        '',
        `NG per step:`,
        ...Object.entries(summary.byStep).map(([k, v]) => `- ${k}: ${v}`),
    ].filter(Boolean).join('\n');

    const report = await chat(cfg, [
        { role: 'system', content: systemMsg },
        { role: 'user', content: dataStr + '\n\nTolong tulis laporan berdasarkan data di atas.' },
    ]);
    return { report, summary };
};

exports.analyzeNG = async (cfg, root, projectName, dateStr) => {
    const p = projects.load(root, projectName);
    const summary = output.dailySummary(p.dir, dateStr);
    const systemMsg = `You are a Six Sigma quality engineer. Given inspection data,
identify:
1. Pola / cluster kegagalan (kalau ada)
2. Kemungkinan root cause (5-Whys style, tapi ringkas)
3. Rekomendasi corrective action prioritas tertinggi
Answer in Bahasa Indonesia. Be specific, actionable, and cite data. Max 400 words.`;

    const dataStr = `Data NG project ${projectName} tanggal ${dateStr}:
NG: ${summary.ng} / ${summary.total} total (${summary.total > 0 ? (summary.ng / summary.total * 100).toFixed(1) : 0}% fail rate)
Waktu siklus avg: ${summary.avgCycleMS.toFixed(1)} ms

NG per step:
${Object.entries(summary.byStep).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;

    const analysis = await chat(cfg, [
        { role: 'system', content: systemMsg },
        { role: 'user', content: dataStr },
    ]);
    return { analysis, summary };
};

// Available models (CosmosHub)
exports.availableModels = () => [
    'qwen-3.7-max',
    'gemini-3.5-flash',
    'gemini-3.1-pro',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'glm-5.2',
    'gpt-5.5',
    'mimo-v2.5',
];
