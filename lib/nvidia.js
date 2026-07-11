// NVIDIA NIM (build.nvidia.com) client — chat completion API OpenAI-compatible.
// Pakai fetch native Node.js 18+.

const path = require('path');
const output = require('./output');
const projects = require('./projects');

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function chat(cfg, messages) {
    if (!cfg.nvidia.api_key) throw new Error('NVIDIA API key kosong (Settings)');
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${cfg.nvidia.api_key}`,
        },
        body: JSON.stringify({
            model: cfg.nvidia.model || 'meta/llama-3.3-70b-instruct',
            messages,
            temperature: 0.3,
            max_tokens: 2048,
            stream: false,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`NIM API ${res.status}: ${err}`);
    }
    const j = await res.json();
    return j.choices[0].message.content;
}

exports.chat = (cfg, messages) => chat(cfg, messages);

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

// Available models
exports.availableModels = () => [
    'meta/llama-3.3-70b-instruct',
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
    'qwen/qwen2.5-coder-32b-instruct',
    'qwen/qwen2.5-7b-instruct',
    'deepseek-ai/deepseek-r1-distill-qwen-32b',
    'nvidia/nemotron-mini-4b-instruct',
    'mistralai/mistral-nemotron',
];
