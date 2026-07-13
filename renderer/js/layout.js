// Layout injector — otomatis pasang menu bar + toolbar + status bar
// pada semua page yang include script ini.
//
// Cara pakai di HTML page:
//   <body>
//     <div id="page-content">...</div>
//     <script src="../js/layout.js"></script>
//   </body>
//
// Options bisa di-set sebelum load layout.js:
//   window.LAYOUT_OPTS = { title: 'Model xyz', showTotalStatus: true, mode: 'setting' };

(function() {
    const opts = window.LAYOUT_OPTS || {};
    const title = opts.title || 'AutomaEyes';
    const subtitle = opts.subtitle || 'Socket Holder Quality Control';
    const mode = opts.mode || 'setting';
    const showTotalStatus = opts.showTotalStatus !== false;
    const showFooter = opts.showFooter !== false;

    // ==== MENU BAR ====
    const menubarHTML = `
        <div class="menubar">
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'fileMenu')">File &#9662;
                <div id="fileMenu" class="util-menu" style="display:none">
                    <div class="util-opt" onclick="window.api.goTo('projects.html')">&#127968; Home (Pilih Project)</div>
                    <div class="util-opt" onclick="location.reload()">&#128260; Refresh Halaman</div>
                    <div class="util-opt" onclick="appExit()">&#9211; Keluar</div>
                </div>
            </div>
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'execMenu')">Execute &#9662;
                <div id="execMenu" class="util-menu" style="display:none">
                    <div class="util-opt" onclick="switchToRunMode()">&#9654;&#65039; Mode Run (Inspeksi)</div>
                </div>
            </div>
            <div class="menu-item" style="position:relative" onclick="toggleMenu(event,'utilMenu')">Utility &#9662;
                <div id="utilMenu" class="util-menu" style="display:none">
                    <div class="util-opt" onclick="syncSaveToCloud(event)">&#9729;&#65039; Save &amp; Upload ke GitHub</div>
                    <div class="util-opt" onclick="syncLoadFromCloud(event)">&#11015;&#65039; Load versi terbaru</div>
                    <div class="util-opt" onclick="showSyncStatus(event)">&#8505;&#65039; Status sinkronisasi</div>
                </div>
            </div>
            <div class="menu-item" onclick="window.api.goTo('settings.html')">Setting</div>
        </div>
    `;

    // ==== TOOLBAR ====
    const toolbarHTML = `
        <div class="toolbar">
            <button class="toolbar-btn" title="Save & Upload ke GitHub" onclick="syncSaveToCloud(event)">💾</button>
            <button class="toolbar-btn" title="Load versi terbaru dari GitHub" onclick="syncLoadFromCloud(event)">📂</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" title="Refresh" onclick="location.reload()">🔄</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" title="Settings" onclick="window.api.goTo('settings.html')">⚙️</button>
        </div>
    `;

    // ==== HEADER ====
    const totalStatusHTML = showTotalStatus ? `
        <div class="total-status-box idle" id="totalStatusBadge">
            <div>
                <div class="label">Total Status</div>
            </div>
            <div class="value" id="totalStatusValue">—</div>
        </div>
    ` : '';

    const modeToggleHTML = `
        <div class="mode-toggle">
            <button class="${mode === 'setting' ? 'active' : ''}" onclick="window.api.goTo('projects.html')">Setting</button>
            <button class="${mode === 'run' ? 'active' : ''}" onclick="switchToRunMode()">Run</button>
        </div>
    `;

    const headerHTML = `
        <div class="header">
            <div class="title-area">
                <h1>${escapeHtml(title)}</h1>
                <div class="subtitle">${escapeHtml(subtitle)}</div>
            </div>
            ${modeToggleHTML}
            ${totalStatusHTML}
        </div>
    `;

    // ==== STATUS BAR ====
    const statusbarHTML = showFooter ? `
        <div class="statusbar">
            <div style="display:flex">
                <span class="status-item">Resource: <strong>OK</strong></span>
                <span class="status-item">Image: <span id="statImg">-</span></span>
                <span class="status-item">Processing: <span id="statProc">-</span></span>
            </div>
            <div style="display:flex">
                <span class="status-item">OK Ratio: <span id="statOk">-</span></span>
                <span class="status-item">Time: <span id="statTime">-</span></span>
            </div>
        </div>
    ` : '';

    // Prepend menu/toolbar/header — TIDAK pakai innerHTML= (bisa hapus event listener
    // yang sudah di-set inline script). Pakai insertAdjacentHTML instead.
    document.body.insertAdjacentHTML('afterbegin', menubarHTML + toolbarHTML + headerHTML);
    if (statusbarHTML) {
        document.body.insertAdjacentHTML('beforeend', statusbarHTML);
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
})();

// Helper functions for pages to update total status
window.setTotalStatus = function(verdict) {
    const badge = document.getElementById('totalStatusBadge');
    const value = document.getElementById('totalStatusValue');
    if (!badge || !value) return;
    badge.classList.remove('pass', 'fail', 'idle');
    if (verdict === 'OK') {
        badge.classList.add('pass');
        value.textContent = 'PASS';
    } else if (verdict === 'NG') {
        badge.classList.add('fail');
        value.textContent = 'FAIL';
    } else {
        badge.classList.add('idle');
        value.textContent = '—';
    }
};

window.switchToRunMode = function() {
    // Nav to Run page for current project kalau ada
    const p = new URLSearchParams(location.search).get('name')
        || new URLSearchParams(location.search).get('project');
    if (p) window.api.goTo(`run.html?project=${encodeURIComponent(p)}`);
    else alert('Pilih project dulu');
};

// ===================== GitHub Sync (Save / Load) =====================
(function () {
    const style = document.createElement('style');
    style.textContent = `
        .util-menu{position:absolute;top:100%;left:0;margin-top:2px;background:#1e2128;
            border:1px solid #3a3f4b;border-radius:5px;min-width:240px;z-index:2000;
            box-shadow:0 6px 18px rgba(0,0,0,.45);overflow:hidden}
        .util-opt{padding:9px 13px;font-size:13px;white-space:nowrap;cursor:pointer;color:#e6e7ea}
        .util-opt:hover{background:#2a2e37}
        #syncToast{position:fixed;right:16px;bottom:44px;z-index:5000;display:flex;flex-direction:column;gap:8px}
        .sync-toast{background:#1e2128;border:1px solid #3a3f4b;border-left-width:4px;border-radius:6px;
            padding:10px 14px;font-size:13px;color:#e6e7ea;max-width:360px;box-shadow:0 6px 18px rgba(0,0,0,.4);
            animation:syncIn .18s ease}
        .sync-toast.ok{border-left-color:#22c55e}
        .sync-toast.err{border-left-color:#ef4444}
        .sync-toast.info{border-left-color:#7c3aed}
        @keyframes syncIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    `;
    document.head.appendChild(style);

    // Tutup semua dropdown menubar saat klik di luar
    document.addEventListener('click', (e) => {
        if (e.target.closest('.menu-item')) return;
        document.querySelectorAll('.util-menu').forEach(m => { m.style.display = 'none'; });
    });

    // Auto-load versi terbaru sekali saat app pertama dibuka
    if (window.api && window.api.gitAutoPullOnce) {
        window.api.gitAutoPullOnce().then((r) => {
            if (!r || r.skipped || !r.result) return;
            const res = r.result;
            if (res.ok && !res.upToDate) _syncToast('⬇️ Versi terbaru dimuat dari GitHub. Refresh bila perlu.', 'ok', 6000);
            else if (!res.ok && (res.dirty || res.diverged)) _syncToast('ℹ️ ' + res.log, 'info', 8000);
            else if (!res.ok) _syncToast('⚠️ Auto-load gagal: ' + _syncShort(res.log), 'err', 8000);
        }).catch(() => {});
    }
})();

function _syncShort(s) { s = String(s || ''); return s.length > 200 ? s.slice(-200) : s; }

function _syncToast(msg, kind, ms) {
    let box = document.getElementById('syncToast');
    if (!box) { box = document.createElement('div'); box.id = 'syncToast'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'sync-toast ' + (kind || 'info');
    t.textContent = msg;
    box.appendChild(t);
    if (ms !== 0) setTimeout(() => { t.remove(); }, ms || 4000);
    return t;
}

// Buka/tutup satu dropdown menubar; tutup yang lain.
function toggleMenu(e, id) {
    if (e) e.stopPropagation();
    const target = document.getElementById(id);
    document.querySelectorAll('.util-menu').forEach(m => { if (m !== target) m.style.display = 'none'; });
    if (target) target.style.display = (target.style.display === 'none' || !target.style.display) ? 'block' : 'none';
}
function _closeUtilMenu() { document.querySelectorAll('.util-menu').forEach(m => { m.style.display = 'none'; }); }

// File → Keluar
function appExit() {
    _closeUtilMenu();
    if (window.api && window.api.quitApp) window.api.quitApp();
    else window.close();
}

// Help → Tentang AutomaEyes (nama + versi dari config)
async function showAbout() {
    _closeUtilMenu();
    try {
        const cfg = await window.api.getConfig();
        const name = (cfg && cfg.app && cfg.app.name) || 'AutomaEyes';
        const ver = (cfg && cfg.app && cfg.app.version) || '';
        _syncToast(`${name}${ver ? ' — v' + ver : ''}\nSistem Quality Control berbasis YOLOv11.`, 'info', 7000);
    } catch (_) {
        _syncToast('AutomaEyes — Sistem Quality Control berbasis YOLOv11.', 'info', 6000);
    }
}

async function syncSaveToCloud(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    const t = _syncToast('☁️ Menyimpan & mengunggah ke GitHub… jangan tutup app.', 'info', 0);
    try {
        const r = await window.api.gitPush();
        t.remove();
        if (r.ok) _syncToast(r.nothing ? '✓ Sudah terbaru — tidak ada perubahan untuk diunggah.' : '✓ Tersimpan & terunggah ke GitHub.', 'ok', 5000);
        else _syncToast('⚠️ ' + _syncShort(r.log), 'err', 9000);
    } catch (err) { t.remove(); _syncToast('⚠️ Error: ' + err.message, 'err', 9000); }
}

async function syncLoadFromCloud(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    const t = _syncToast('⬇️ Mengambil versi terbaru dari GitHub…', 'info', 0);
    try {
        const r = await window.api.gitPull();
        t.remove();
        if (r.ok) _syncToast(r.upToDate ? '✓ Sudah versi terbaru.' : '✓ Versi terbaru dimuat. Refresh halaman bila perlu.', 'ok', 6000);
        else _syncToast('⚠️ ' + _syncShort(r.log), 'err', 9000);
    } catch (err) { t.remove(); _syncToast('⚠️ Error: ' + err.message, 'err', 9000); }
}

async function showSyncStatus(e) {
    if (e) e.stopPropagation();
    _closeUtilMenu();
    try {
        const s = await window.api.gitStatus();
        if (!s.repo) return _syncToast('Folder app bukan git repo.', 'err', 6000);
        if (!s.hasRemote) return _syncToast('Belum tersambung ke GitHub (belum ada remote origin).', 'err', 7000);
        _syncToast(`Branch: ${s.branch} · ${s.dirty ? s.changes + ' perubahan belum disimpan' : 'bersih (sudah tersimpan)'}\n${s.remote}`, 'info', 8000);
    } catch (err) { _syncToast('⚠️ ' + err.message, 'err', 7000); }
}
