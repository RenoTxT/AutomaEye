// Common helpers untuk semua page

// URL query param
function param(k) {
    return new URLSearchParams(location.search).get(k);
}

// Navigation
function goTo(page, params) {
    let target = page;
    if (params) target += '?' + new URLSearchParams(params).toString();
    window.api.goTo(page + (params ? '?' + new URLSearchParams(params).toString() : ''));
}

// Format helpers
function humanTime(iso) {
    const t = new Date(iso);
    const d = (Date.now() - t.getTime()) / 1000;
    if (d < 60) return 'baru saja';
    if (d < 3600) return Math.floor(d / 60) + ' menit lalu';
    if (d < 86400) return Math.floor(d / 3600) + ' jam lalu';
    return t.toISOString().slice(0, 10);
}

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
