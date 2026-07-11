// Arduino serial handler. Try to open port on init; expose send() function.
// Kalau gagal (COM port salah), tidak fatal — user bisa fix di Settings.

let port = null;
let SerialPort = null;

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
            // Tunggu Arduino reset 2 detik
            setTimeout(resolve, 2000);
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

exports.close = () => {
    if (port) {
        try { port.close(); } catch (_) {}
        port = null;
    }
};

exports.status = () => ({ connected: !!port });
