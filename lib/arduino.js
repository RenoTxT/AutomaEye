// Arduino serial handler. Try to open port on init; expose send() function.
// Kalau gagal (COM port salah), tidak fatal — user bisa fix di Settings.

let port = null;
let SerialPort = null;
let rxBuffer = '';       // tampung data masuk dari Arduino (untuk handshake)

try {
    ({ SerialPort } = require('serialport'));
} catch (e) {
    console.warn('[arduino] serialport package tidak terinstall:', e.message);
}

exports.init = async (arduinoCfg) => {
    if (!SerialPort) return;
    if (!arduinoCfg.port) return;
    return new Promise((resolve, reject) => {
        port = new SerialPort({
            path: arduinoCfg.port,
            baudRate: arduinoCfg.baud || 9600,
        }, (err) => {
            if (err) {
                console.warn(`[arduino] open ${arduinoCfg.port} gagal:`, err.message);
                port = null;
                reject(err);
                return;
            }
            console.log(`[arduino] Connected ${arduinoCfg.port} @ ${arduinoCfg.baud}`);
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
    port = null;                       // cegah pemakaian ulang & double-close
    if (!p) return;
    try {
        if (p.isOpen) p.close(() => { });   // hanya close bila memang terbuka; callback telan error async
    } catch (_) { /* "Port is not open" dll — abaikan */ }
};

exports.status = () => ({ connected: !!port });
