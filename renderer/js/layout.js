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
            <div class="menu-item" onclick="window.api.goTo('projects.html')">File</div>
            <div class="menu-item">Edit</div>
            <div class="menu-item">Display</div>
            <div class="menu-item">Execute</div>
            <div class="menu-item">Utility</div>
            <div class="menu-item" onclick="window.api.goTo('settings.html')">Setting</div>
            <div class="menu-item">System</div>
            <div class="menu-item">Help</div>
        </div>
    `;

    // ==== TOOLBAR ====
    const toolbarHTML = `
        <div class="toolbar">
            <button class="toolbar-btn" title="Home" onclick="window.api.goTo('projects.html')">🏠</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" title="Save">💾</button>
            <button class="toolbar-btn" title="Load">📂</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn" title="Zoom In">🔍</button>
            <button class="toolbar-btn" title="Zoom Out">🔎</button>
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
