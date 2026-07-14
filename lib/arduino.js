// Arduino serial handler. Try to open port on init; expose send() function.
// Kalau gagal (COM port salah), tidak fatal — user bisa fix di Settings.

let port = null;
let SerialPort = null;
let rxBuffer = '';       // tampung data masuk dari Arduino (untuk handshake)
let connectedPath = null; // port yang benar-benar terhubung (untuk status)

try {
    ({ SerialPort } = require('serialport'));
} catch (e) {
    console.warn('[arduino] serialport package tidak terinstall:', e.message);
}

// Daftar COM/serial port yang tersedia di sistem.
exports.listPorts = async () => {
    if (!SerialPort || !SerialPort.list) return [];
    try { return await SerialPort.list(); } catch (_) { return []; }
};

// Apakah port ini kemungkinan board Arduino/Wemos (CH340/CP210x/FTDI/Arduino).
function looksLikeBoard(p) {
    const s = ((p.manufacturer || '') + ' ' + (p.friendlyName || '') + ' ' + (p.pnpId || '')).toLowerCase();
    const vid = (p.vendorId || '').toLowerCase();
    return /wch|ch340|ch910|silabs|cp210|arduino|usb-serial|usb serial|ftdi/.test(s)
        || ['1a86', '10c4', '2341', '0403'].includes(vid);
}

// Tentukan port yang dipakai: kalau `preferred` masih ada → pakai; kalau tidak,
// cari port yang paling mungkin board; kalau tak ada, port pertama yang tersedia.
exports.resolvePort = async (preferred) => {
    const ports = await exports.listPorts();
    if (preferred && preferred !== 'auto' && ports.some(p => p.path === preferred)) return preferred;
    const cand = ports.find(looksLikeBoard) || ports[0];
    return cand ? cand.path : null;
};

exports.connectedPort = () => connectedPath;

exports.init = async (arduinoCfg) => {
    if (!SerialPort) return;
    // Auto-deteksi: kalau port kosong/'auto' atau COM yang diset tidak ada, cari sendiri.
    const path = await exports.resolvePort(arduinoCfg.port);
    if (!path) { console.warn('[arduino] tidak ada COM port tersedia'); return; }
    return new Promise((resolve, reject) => {
        port = new SerialPort({
            path,
            baudRate: arduinoCfg.baud || 9600,
        }, (err) => {
            if (err) {
                console.warn(`[arduino] open ${path} gagal:`, err.message);
                port = null; connectedPath = null;
                reject(err);
                return;
            }
            connectedPath = path;
            console.log(`[arduino] Connected ${path} @ ${arduinoCfg.baud}`);
            // ESP8266/Wemos: lepaskan DTR & RTS supaya board MENJALANKAN sketch,
            // bukan tertahan di mode bootloader saat port dibuka.
            try {
                port.set({ dtr: false, rts: false }, () => {
                    // Pulse reset singkat lalu lepas → board boot ke sketch.
                    port.set({ rts: true, dtr: false }, () => {
                        setTimeout(() => port.set({ rts: false, dtr: false }, () => { }), 100);
                    });
                });
            } catch (e) { /* sebagian driver tak dukung set() — abaikan */ }
            // Telan error serial (mis. kabel dicabut, port ditutup) supaya TIDAK jadi
            // uncaught exception yang mematikan app.
            port.on('error', (e) => console.warn('[arduino] serial error:', e && e.message));
            // Tampung data masuk (untuk handshake "close/ready").
            rxBuffer = '';
            port.on('data', (d) => {
                rxBuffer += d.toString();
                if (rxBuffer.length > 4096) rxBuffer = rxBuffer.slice(-1024);
            });
            // Tunggu Wemos reset & boot ~2.5 detik sebelum siap kirim.
            setTimeout(resolve, 2500);
        });
    });
};

exports.send = (data) => {
    return new Promise((resolve, reject) => {
        if (!port) return resolve({ ok: false, reason: 'not connected' });
        port.write(data, (err) => {
            if (err) return reject(err);
            resolve({ ok: true });
        });
    });
};

exports.openGate = () => exports.send('O\n');
exports.closeGate = () => exports.send('C\n');

// Kosongkan buffer masuk sebelum menunggu balasan baru.
exports.flushRx = () => { rxBuffer = ''; };

// Tunggu Arduino mengirim `token` (mis. "C" / "READY" / "DONE") menandakan
// output/gerbang sudah menutup lagi → aman lanjut ke deteksi berikutnya.
// Kalau tidak ada port / token kosong → langsung lanjut. Ada timeout supaya tak menggantung.
exports.waitFor = (token, timeoutMs = 5000) => new Promise((resolve) => {
    if (!port || !token) return resolve({ ok: true, skipped: true });
    const start = Date.now();
    const tick = () => {
        if (rxBuffer.includes(token)) { rxBuffer = ''; return resolve({ ok: true }); }
        if (Date.now() - start > timeoutMs) return resolve({ ok: false, timeout: true });
        setTimeout(tick, 20);
    };
    tick();
});

exports.close = () => {
    const p = port;
    port = null; connectedPath = null; // cegah pemakaian ulang & double-close
    if (!p) return;
    try {
        if (p.isOpen) p.close(() => { });   // hanya close bila memang terbuka; callback telan error async
    } catch (_) { /* "Port is not open" dll — abaikan */ }
};

exports.status = () => ({ connected: !!port });
