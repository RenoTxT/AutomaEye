// lib/gitsync.js — sinkronisasi folder app ke GitHub.
//
// Save  = git add -A + commit + push  (unggah dataset, anotasi, model, project)
// Load  = git pull --ff-only          (ambil versi terbaru dari device lain)
//
// Semua operasi jalan di root repo (folder app, tempat main.js berada).
// Autentikasi memakai kredensial git yang sudah tersimpan di mesin
// (Git Credential Manager) — tidak menyimpan token di app.

const { execFile } = require('child_process');

function git(cwd, args, timeout = 600000) {
    return new Promise((resolve) => {
        execFile('git', args, {
            cwd,
            timeout,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 32,
        }, (err, stdout, stderr) => {
            resolve({
                code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
                out: ((stdout || '') + (stderr || '')).trim(),
            });
        });
    });
}

// Info dasar repo: apakah git, ada remote, branch, dan jumlah perubahan lokal.
exports.status = async (cwd) => {
    const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0) return { repo: false };
    const remote = await git(cwd, ['remote', 'get-url', 'origin']);
    const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const dirty = await git(cwd, ['status', '--porcelain']);
    const changes = dirty.out ? dirty.out.split(/\r?\n/).filter(Boolean).length : 0;
    return {
        repo: true,
        hasRemote: remote.code === 0,
        remote: remote.out,
        branch: branch.out || 'main',
        dirty: changes > 0,
        changes,
    };
};

// Simpan & unggah semua perubahan ke GitHub.
exports.push = async (cwd, message) => {
    const st = await exports.status(cwd);
    if (!st.repo) return { ok: false, log: 'Folder app bukan git repository.' };
    if (!st.hasRemote) {
        return { ok: false, log: 'Belum tersambung ke GitHub. Set dulu: git remote add origin <url-repo>.' };
    }

    let log = '';
    const add = await git(cwd, ['add', '-A']);
    log += add.out;

    const msg = (message && message.trim())
        ? message.trim()
        : 'AutomaEyes sync ' + new Date().toISOString();
    const commit = await git(cwd, ['commit', '-m', msg]);
    log += '\n' + commit.out;
    const nothing = /nothing to commit|nothing added to commit/i.test(commit.out);

    // Kalau tidak ada perubahan baru DAN lokal tidak ketinggalan, cukup selesai.
    const push = await git(cwd, ['push', 'origin', st.branch]);
    log += '\n' + push.out;

    if (push.code !== 0 && /rejected|fetch first|non-fast-forward|behind/i.test(push.out)) {
        return {
            ok: false, rejected: true, nothing,
            log: 'Versi di GitHub lebih baru dari lokal. Klik "Load" dulu untuk ambil versi terbaru, baru Save lagi.',
        };
    }
    return { ok: push.code === 0, nothing, log: log.trim() };
};

// Ambil versi terbaru dari GitHub (hanya fast-forward supaya aman).
exports.pull = async (cwd) => {
    const st = await exports.status(cwd);
    if (!st.repo) return { ok: false, log: 'Folder app bukan git repository.' };
    if (!st.hasRemote) return { ok: false, log: 'Belum tersambung ke GitHub (origin).' };

    if (st.dirty) {
        return {
            ok: false, dirty: true,
            log: `Ada ${st.changes} perubahan lokal yang belum disimpan. Klik "Save" dulu sebelum Load, supaya tidak tertimpa.`,
        };
    }
    const pull = await git(cwd, ['pull', '--ff-only', 'origin', st.branch]);
    const upToDate = /up to date|sudah|already up/i.test(pull.out);
    if (pull.code !== 0 && /not possible to fast-forward|diverg/i.test(pull.out)) {
        return {
            ok: false, diverged: true,
            log: 'Ada perubahan lokal yang menyimpang dari GitHub. Perlu diselesaikan manual (git status).',
        };
    }
    return { ok: pull.code === 0, upToDate, log: pull.out };
};
